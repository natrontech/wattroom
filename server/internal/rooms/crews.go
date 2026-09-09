package rooms

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// roomAccess is what a room row can say about itself without being opened
// (#1149). The absence of a mark is a state too, so "open" is a word here.
const (
	// Open to the crew: ADR-0038's default for rooms made after the cutover.
	accessOpen = "open"
	// Private, and you are in it — every room that existed at migration.
	accessPrivate = "private"
	// Private, and you are not: visible because you are crew, not enterable.
	accessLocked = "locked"
	// A crew admin's or the owner's sight only: listed, permissions
	// manageable, contents not readable (ADR-0038, second amendment).
	accessAdmin = "admin"
)

type crewPersonJSON struct {
	ID           string  `json:"id"`
	DisplayName  string  `json:"displayName"`
	AvatarURL    *string `json:"avatarUrl,omitempty"`
	AvatarPreset *string `json:"avatarPreset,omitempty"`
	// owner | admin | member — banned people are on their own list.
	Role string `json:"role"`
	// First joined any of the crew's rooms; the crew's own "since".
	Since string `json:"since"`
	// How many of the crew's rooms hold them. Not which: that is the rooms'
	// business, and a crew admin may not read rooms they never joined.
	Rooms int64 `json:"rooms,omitempty"`
	// Owns a room in the crew, so cannot be banned from it (#1212) — the menu
	// withholds the ban rather than offering one that fails.
	OwnsRoom bool `json:"ownsRoom,omitempty"`
}

type crewRoomJSON struct {
	ID string `json:"id"`
	// Absent on a row the caller may not enter — see doorOf.
	Slug   string `json:"slug,omitempty"`
	Name   string `json:"name"`
	Icon   string `json:"icon,omitempty"`
	Access string `json:"access"`
}

type crewJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon,omitempty"`
	// The logo (#1237), when one is set.
	ImageURL string `json:"imageUrl,omitempty"`
	// The invite (#1236): the crew's code, and the one thing to share. Every
	// member sees it — inviting is every member's (docs/SPEC.md).
	Code string `json:"code,omitempty"`
	// The caller's own role: owner | admin | member.
	Role    string           `json:"role"`
	OwnerID string           `json:"ownerId"`
	Rooms   []crewRoomJSON   `json:"rooms"`
	People  []crewPersonJSON `json:"people"`
	// Admins and the owner only — a ban list is a moderation surface, not
	// roster gossip, the same rule the room's Members place applies.
	Banned []crewPersonJSON `json:"banned,omitempty"`
}

func (s *Service) registerCrews(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/crews/{id}", s.handleGetCrew)
	// The door lives under its own prefix: "/api/crews/by-code/{code}" and
	// "/api/crews/{id}/image" are both four segments, and Go's mux refuses a
	// pair where "by-code/image" would match either.
	mux.HandleFunc("GET /api/crew-doors/{code}", s.handleCrewDoor)
	mux.HandleFunc("POST /api/crews/join", s.handleJoinCrew)
	mux.HandleFunc("POST /api/crews/{id}/leave", s.handleLeaveCrew)
	mux.HandleFunc("PATCH /api/crews/{id}", s.handleUpdateCrew)
	mux.HandleFunc("POST /api/crews/{id}/role", s.handleSetCrewRole)
	mux.HandleFunc("POST /api/crews/{id}/transfer", s.handleTransferCrew)
	mux.HandleFunc("PATCH /api/crews/{id}/rooms/{roomID}/access", s.handleSetRoomAccess)
	mux.HandleFunc("POST /api/crews/{id}/image", s.handleSetCrewImage)
	mux.HandleFunc("DELETE /api/crews/{id}/image", s.handleClearCrewImage)
	mux.HandleFunc("GET /api/crews/{id}/image", s.handleCrewImage)
	mux.HandleFunc("GET /api/crew-doors/{code}/image", s.handleCrewDoorImage)
}

// crewFor is the crew a room is created into: the one the rider owns, made
// the first time they open a room and named after them — the migration's
// one-crew-per-owner rule applied to accounts that arrive after it. That is
// also what makes them the crew's owner without a backfill (ADR-0038,
// second amendment).
func (s *Service) crewFor(ctx context.Context, user db.User) (db.Crew, error) {
	crew, err := s.store.Queries.GetCrewOwnedBy(ctx, user.ID)
	if err == nil {
		return crew, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return db.Crew{}, err
	}
	name := strings.TrimSpace(user.DisplayName)
	if name == "" {
		name = "My crew"
	}
	// The code is the crew's invite (#1236); the unique index is the check,
	// so a collision retries rather than being looked for first.
	for attempt := 0; ; attempt++ {
		code := randomCode(6)
		crew, err := s.store.Queries.CreateCrew(ctx, db.CreateCrewParams{Name: name, OwnerID: user.ID, Code: &code})
		if err == nil || !isUniqueViolation(err) || attempt >= 3 {
			return crew, err
		}
	}
}

// crewByID loads the crew at {id} and refuses unless the caller is in it,
// administers it or owns it. 404 rather than 403 for everyone else: a crew is
// reached only through one of its rooms, so its existence is not public the
// way a room's shareable link is.
func (s *Service) crewByID(w http.ResponseWriter, r *http.Request) (db.GetCrewRow, db.User, string, bool) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return db.GetCrewRow{}, db.User{}, "", false
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No crew lives here.")
		return db.GetCrewRow{}, db.User{}, "", false
	}
	crew, err := s.store.Queries.GetCrew(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No crew lives here.")
		return db.GetCrewRow{}, db.User{}, "", false
	}
	if err != nil {
		s.log.Error("crew lookup failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The crew could not be loaded.")
		return db.GetCrewRow{}, db.User{}, "", false
	}
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: user.ID})
	if err != nil {
		s.log.Error("crew role lookup failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The crew could not be loaded.")
		return db.GetCrewRow{}, db.User{}, "", false
	}
	if role == "" || role == "banned" {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No crew lives here.")
		return db.GetCrewRow{}, db.User{}, "", false
	}
	return crew, user, role, true
}

func administers(role string) bool { return role == "owner" || role == "admin" }

// codeOf: crews.code is nullable for one release (ADR-0019) and every crew
// has one from the cutover on, so "" only ever means a row older than the
// migration that should not exist.
func codeOf(code *string) string {
	if code == nil {
		return ""
	}
	return *code
}

// asRow is the crew as every handler sees it: GetCrew's shape, which leaves
// the image bytes behind (#1237). CreateCrew and GetCrewOwnedBy still hand
// back the full row, and this is where they meet the rest.
func asRow(c db.Crew) db.GetCrewRow {
	return db.GetCrewRow{
		ID: c.ID, Name: c.Name, Icon: c.Icon, OwnerID: c.OwnerID, CreatedAt: c.CreatedAt,
		Code: c.Code, HasImage: c.ImageSetAt.Valid,
	}
}

func (s *Service) handleGetCrew(w http.ResponseWriter, r *http.Request) {
	crew, user, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	out := crewJSON{
		ID: store.UUIDString(crew.ID), Name: crew.Name, Icon: crew.Icon, Role: role, Code: codeOf(crew.Code),
		ImageURL: crewImageURL(crew.ID, crew.HasImage),
		OwnerID:  store.UUIDString(crew.OwnerID),
		Rooms:    []crewRoomJSON{}, People: []crewPersonJSON{},
	}
	// The rooms, with what the CALLER may do in each — the same four states
	// the sidebar draws, from the same two queries.
	mine, err := s.store.Queries.ListUserRooms(r.Context(), user.ID)
	if err != nil {
		s.log.Error("list rooms failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The crew could not be loaded.")
		return
	}
	for _, room := range mine {
		if room.CrewID == crew.ID {
			out.Rooms = append(out.Rooms, crewRoomJSON{
				ID: store.UUIDString(room.ID), Slug: room.Slug, Name: room.Name, Icon: room.Icon,
				Access: accessOf(room.CrewVisible, true, false),
			})
		}
	}
	others, err := s.store.Queries.ListCrewRoomsFor(r.Context(), user.ID)
	if err != nil {
		s.log.Error("list crew rooms failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The crew could not be loaded.")
		return
	}
	for _, room := range others {
		if room.CrewID == crew.ID {
			slug, access := doorOf(room)
			out.Rooms = append(out.Rooms, crewRoomJSON{
				ID: store.UUIDString(room.ID), Slug: slug, Name: room.Name, Icon: room.Icon, Access: access,
			})
		}
	}
	roles, err := s.store.Queries.ListCrewRoles(r.Context(), crew.ID)
	if err != nil {
		s.log.Error("list crew roles failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The crew could not be loaded.")
		return
	}
	admin := map[string]bool{}
	for _, row := range roles {
		if row.Role == "admin" {
			admin[store.UUIDString(row.UserID)] = true
		}
	}
	people, err := s.store.Queries.ListCrewPeople(r.Context(), db.ListCrewPeopleParams{
		CrewID: crew.ID, Everyone: administers(role), Viewer: user.ID,
	})
	if err != nil {
		s.log.Error("list crew people failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The crew could not be loaded.")
		return
	}
	for _, p := range people {
		id := store.UUIDString(p.ID)
		personRole := "member"
		switch {
		case p.ID == crew.OwnerID:
			personRole = "owner"
		case admin[id]:
			personRole = "admin"
		}
		out.People = append(out.People, crewPersonJSON{
			ID: id, DisplayName: p.DisplayName, AvatarURL: p.AvatarUrl, AvatarPreset: p.AvatarPreset,
			Role: personRole, Since: p.Since.Time.Format("2006-01-02"), Rooms: p.RoomCount,
			OwnsRoom: p.OwnsRoom,
		})
	}
	if administers(role) {
		banned, err := s.store.Queries.ListCrewBanned(r.Context(), crew.ID)
		if err != nil {
			s.log.Error("list crew bans failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The crew could not be loaded.")
			return
		}
		for _, p := range banned {
			out.Banned = append(out.Banned, crewPersonJSON{
				ID: store.UUIDString(p.ID), DisplayName: p.DisplayName,
				AvatarURL: p.AvatarUrl, AvatarPreset: p.AvatarPreset,
				Role: "banned", Since: p.SetAt.Time.Format("2006-01-02"),
			})
		}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
