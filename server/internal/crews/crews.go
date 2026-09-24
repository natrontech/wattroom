package crews

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/status"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type crewPersonJSON struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl,omitempty"`
	// owner | admin | member — banned people are on their own list.
	Role string `json:"role"`
	// When they joined the crew.
	Since string `json:"since"`
	// Medals the crew's sessions awarded them, lifetime — on the Members
	// page's roster only (#2442), counted by id like the room's (#1371).
	Medals int `json:"medals,omitempty"`
	// Their own line (ADR-0060); null for none and on the ban list.
	StatusLine *protocol.StatusLine `json:"statusLine"`
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
	Role    string `json:"role"`
	OwnerID string `json:"ownerId"`
	// How many are in the crew — the door's number. `people` below is the
	// part of them the caller may see (#1135), which is shorter for a plain
	// member; labelling that list as the crew's size said "2 people" to
	// someone who had just read "12 are in it" (audit 2026-09-09).
	Members int64            `json:"members"`
	People  []crewPersonJSON `json:"people"`
	// A person has named it (#1151) — the placeholder hint goes when true.
	Named bool `json:"named"`
	// Admins and the owner only — a ban list is a moderation surface, not
	// roster gossip, the same rule the room's Members place applies.
	Banned []crewPersonJSON `json:"banned,omitempty"`
	// Admins and the owner only: whether the crew is in the directory — the
	// state of the switch only they can throw.
	Listed bool `json:"listed,omitempty"`
	// The weekly board is on (ADR-0036 as amended by ADR-0058).
	BoardEnabled bool `json:"boardEnabled,omitempty"`
	// The reaction palette every voice channel of the crew speaks.
	Cheers []string `json:"cheers"`
	// The crew's calendar feed (#2441, ADR-0021): every member gets it, as
	// every member of a room did — the feed is for sharing.
	IcsToken string `json:"icsToken,omitempty"`
}

func (s *Service) registerCrews(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/crews", s.handleMyCrews)
	mux.HandleFunc("POST /api/crews", s.handleFoundCrew)
	mux.HandleFunc("GET /api/crews/{id}", s.handleGetCrew)
	// The literal outranks the wildcard above in Go's mux.
	mux.HandleFunc("GET /api/crews/directory", s.handleCrewDirectory)
	// The door lives under its own prefix: "/api/crews/by-code/{code}" and
	// "/api/crews/{id}/image" are both four segments, and Go's mux refuses a
	// pair where "by-code/image" would match either.
	mux.HandleFunc("GET /api/crew-doors/{code}", s.handleCrewDoor)
	mux.HandleFunc("POST /api/crew-doors/{code}/remember", s.handleRememberCrewDoor)
	mux.HandleFunc("POST /api/crews/join", s.handleJoinCrew)
	mux.HandleFunc("POST /api/crews/{id}/leave", s.handleLeaveCrew)
	mux.HandleFunc("PATCH /api/crews/{id}", s.handleUpdateCrew)
	mux.HandleFunc("POST /api/crews/{id}/code", s.handleRotateCrewCode)
	mux.HandleFunc("POST /api/crews/{id}/role", s.handleSetCrewRole)
	mux.HandleFunc("POST /api/crews/{id}/transfer", s.handleTransferCrew)
	mux.HandleFunc("POST /api/crews/{id}/image", s.handleSetCrewImage)
	mux.HandleFunc("DELETE /api/crews/{id}/image", s.handleClearCrewImage)
	mux.HandleFunc("GET /api/crews/{id}/image", s.handleCrewImage)
	mux.HandleFunc("GET /api/crew-doors/{code}/image", s.handleCrewDoorImage)
	mux.HandleFunc("GET /api/crews/{id}/members", s.handleCrewMembers)
	mux.HandleFunc("PATCH /api/crews/{id}/me", s.handleSetCrewPrefs)
	mux.HandleFunc("GET /api/crews/{id}/recaps", s.handleCrewRecaps)
	s.registerCrewSchedule(mux)
}

// handleMyCrews is every crew the caller is in (#1476), for the switcher and
// Home. It rode on the room list until the rooms went (#2446).
func (s *Service) handleMyCrews(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListCrewsFor(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list crews failed", err, "Your crews could not be loaded. Try again.", "user", store.UUIDString(user.ID))
		return
	}
	out := make([]crewRefJSON, 0, len(rows))
	for _, c := range rows {
		role := "member"
		if c.Owned {
			role = "owner"
		} else if c.Admin {
			role = "admin"
		}
		out = append(out, crewRefJSON{
			Id: store.UUIDString(c.ID), Name: c.Name, Icon: c.Icon,
			ImageURL: crewImageURL(c.ID, c.HasImage), Code: c.Code,
			Role: role, Named: c.Named, Founded: c.Founded,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"crews": out})
}

// crewByID loads the crew at {id} and refuses unless the caller is in it,
// administers it or owns it. 404 rather than 403 for everyone else: a crew is
// reached by its code, so its id tells a stranger nothing, not even that it
// exists.
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
		httpx.Fail(w, s.log, "crew lookup failed", err, "The crew could not be loaded.")
		return db.GetCrewRow{}, db.User{}, "", false
	}
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "crew role lookup failed", err, "The crew could not be loaded.")
		return db.GetCrewRow{}, db.User{}, "", false
	}
	if role == "" || role == "banned" {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No crew lives here.")
		return db.GetCrewRow{}, db.User{}, "", false
	}
	return crew, user, role, true
}

// crewPeople is the crew's roster as the caller may read it — the crew page
// and its Members page (#2442) draw the same list — and, for its owner and
// admins, the ban list beside it.
func (s *Service) crewPeople(ctx context.Context, crew db.GetCrewRow, user db.User, role string) ([]crewPersonJSON, []crewPersonJSON, error) {
	roles, err := s.store.Queries.ListCrewRoles(ctx, crew.ID)
	if err != nil {
		return nil, nil, err
	}
	admin := map[string]bool{}
	for _, row := range roles {
		if row.Role == "admin" {
			admin[store.UUIDString(row.UserID)] = true
		}
	}
	rows, err := s.store.Queries.ListCrewPeople(ctx, db.ListCrewPeopleParams{
		CrewID: crew.ID, Everyone: administers(role), Viewer: user.ID,
	})
	if err != nil {
		return nil, nil, err
	}
	people := make([]crewPersonJSON, 0, len(rows))
	now := time.Now()
	for _, p := range rows {
		id := store.UUIDString(p.ID)
		personRole := "member"
		switch {
		case p.ID == crew.OwnerID:
			personRole = "owner"
		case admin[id]:
			personRole = "admin"
		}
		people = append(people, crewPersonJSON{
			ID: id, DisplayName: p.DisplayName, AvatarURL: p.AvatarUrl,
			Role: personRole, Since: p.Since.Time.Format("2006-01-02"),
			StatusLine: status.Of(p.StatusEmoji, p.StatusEmojiID, p.StatusText, p.StatusExpiresAt, now),
		})
	}
	if !administers(role) {
		return people, nil, nil
	}
	bannedRows, err := s.store.Queries.ListCrewBanned(ctx, crew.ID)
	if err != nil {
		return nil, nil, err
	}
	var banned []crewPersonJSON
	for _, p := range bannedRows {
		banned = append(banned, crewPersonJSON{
			ID: store.UUIDString(p.ID), DisplayName: p.DisplayName,
			AvatarURL: p.AvatarUrl,
			Role:      "banned", Since: p.SetAt.Time.Format("2006-01-02"),
		})
	}
	return people, banned, nil
}

func administers(role string) bool { return role == "owner" || role == "admin" }

// codeOf: crews.code is still nullable in the column type, but crews_code_present
// (#2334) refuses a new row without one and every crew has had one since the
// 20260908204419 backfill, so "" only ever means a row that should not exist.
// The nil branch goes when that constraint is validated (#2333's visit) and
// the column can take its not null.
func codeOf(code *string) string {
	if code == nil {
		return ""
	}
	return *code
}

func (s *Service) handleGetCrew(w http.ResponseWriter, r *http.Request) {
	crew, user, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	out := crewJSON{
		ID: store.UUIDString(crew.ID), Name: crew.Name, Icon: crew.Icon, Role: role, Code: codeOf(crew.Code),
		ImageURL:     crewImageURL(crew.ID, crew.HasImage),
		OwnerID:      store.UUIDString(crew.OwnerID),
		Named:        crew.Named,
		People:       []crewPersonJSON{},
		Listed:       administers(role) && crew.Listed,
		BoardEnabled: crew.BoardEnabled,
		Cheers:       CheerSet(crew.Cheers),
		IcsToken:     crew.IcsToken,
	}
	people, banned, err := s.crewPeople(r.Context(), crew, user, role)
	if err != nil {
		httpx.Fail(w, s.log, "list crew people failed", err, "The crew could not be loaded.")
		return
	}
	out.People, out.Banned = people, banned
	out.Members = int64(len(people))
	if members, err := s.store.Queries.CountCrewMembers(r.Context(), crew.ID); err == nil {
		out.Members = int64(members)
	} else {
		s.log.Warn("crew member count failed", "err", err, "crew", store.UUIDString(crew.ID))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
