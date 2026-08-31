// Package rooms is persistent rooms (#17): create, join via link or code,
// roles per the docs/SPEC.md matrix. Durable data only — everything live
// (ticks, timers, presence) stays in the hub (#18).
package rooms

import (
	"crypto/rand"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"fmt"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// UserSource is what rooms needs from auth — defined here, where it is
// consumed, and satisfied by *auth.Service.
type UserSource interface {
	User(r *http.Request) (db.User, bool)
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// maxOwnedRooms is docs/SPEC.md's ownership cap (membership is uncapped).
const maxOwnedRooms = 3

// maxCheers caps the owner-curated reaction palette (#223).
const maxCheers = 8

// baseCheers is the stock reaction set (WATTROOM.md feel layer) — what a
// room speaks until its owner curates their own.
var baseCheers = []string{"🔥", "💪", "👏", "💀", "🚀", "🧊"}

// cheerSet parses the stored space-joined palette; ” means the base set.
func cheerSet(stored string) []string {
	if stored == "" {
		return baseCheers
	}
	return strings.Fields(stored)
}

// Presence is what rooms borrows from the hub — defined here, where it is
// consumed. Optional: without it every room reads as quiet and a ban can't
// sever a live socket.
type Presence interface {
	Presence(slug string) protocol.RoomPresence
	Kick(slug, userID string)
	// A role change has to reach the sockets that are already open, or the
	// new coach stays refused until they reconnect.
	SetRole(slug, userID, role string)
}

// VoiceEjector is the LiveKit arm of a kick — satisfied by *av.Service.
// Optional: without AV there is no voice to eject anyone from.
type VoiceEjector interface {
	Eject(slug, userID string)
}

// Notifier is what scheduling needs from notify (#117) — defined here, where
// it is consumed. Optional: without it planning a session emails nobody.
type Notifier interface {
	SessionPlanned(room db.Room, workoutName string, startsAt time.Time, planner pgtype.UUID)
	SessionRescheduled(room db.Room, workoutName string, startsAt time.Time, planner pgtype.UUID)
}

type Service struct {
	store    *store.Store
	users    UserSource
	log      *slog.Logger
	presence Presence
	notifier Notifier
	voice    VoiceEjector
}

// SetPresence wires the hub in after construction (the hub needs this service
// first, as its Access).
func (s *Service) SetPresence(p Presence) { s.presence = p }

// SetVoiceEjector wires LiveKit ejection in when AV is configured.
func (s *Service) SetVoiceEjector(v VoiceEjector) { s.voice = v }

// evict severs the target's live presence — metrics socket and voice. A ban
// or removal must eject, not drift until the rider happens to disconnect.
func (s *Service) evict(slug, userID string) {
	if s.presence != nil {
		s.presence.Kick(slug, userID)
	}
	if s.voice != nil {
		s.voice.Eject(slug, userID)
	}
}

// SetNotifier wires session-planned email in when the server can send.
func (s *Service) SetNotifier(n Notifier) { s.notifier = n }

func New(st *store.Store, users UserSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/rooms", s.handleCreate)
	mux.HandleFunc("GET /api/rooms", s.handleMine)
	mux.HandleFunc("POST /api/rooms/join", s.handleJoinByCode)
	mux.HandleFunc("GET /api/rooms/{slug}", s.handleGet)
	mux.HandleFunc("PATCH /api/rooms/{slug}", s.handleUpdate)
	mux.HandleFunc("DELETE /api/rooms/{slug}", s.handleDelete)
	mux.HandleFunc("POST /api/rooms/{slug}/schedule", s.handleSchedule)
	mux.HandleFunc("PATCH /api/rooms/{slug}/schedule/{id}", s.handleReschedule)
	mux.HandleFunc("DELETE /api/rooms/{slug}/schedule/{id}", s.handleUnschedule)
	mux.HandleFunc("GET /api/rooms/{slug}/calendar/{token}", s.handleCalendar)
	mux.HandleFunc("POST /api/rooms/{slug}/calendar/rotate", s.handleRotateIcs)
	mux.HandleFunc("GET /api/schedule", s.handleMySchedule)
	mux.HandleFunc("GET /api/calendar/{token}", s.handleUserCalendar)
	mux.HandleFunc("POST /api/calendar/rotate", s.handleRotateUserIcs)
	mux.HandleFunc("POST /api/rooms/{slug}/join", s.handleJoin)
	mux.HandleFunc("POST /api/rooms/{slug}/role", s.handleSetRole)
	mux.HandleFunc("DELETE /api/rooms/{slug}/members/{userID}", s.handleRemoveMember)
}

// --- responses ---

type memberJSON struct {
	ID           string  `json:"id"`
	DisplayName  string  `json:"displayName"`
	AvatarURL    *string `json:"avatarUrl,omitempty"`
	AvatarPreset *string `json:"avatarPreset,omitempty"`
	Role         string  `json:"role"`
	// Room-visible rider facts (#207) — the same numbers the roster already
	// shows on tiles; rides and history stay private. Lifetime XP joined
	// them in #253: the level is room-visible identity, the rides are not.
	TotalXp  int64  `json:"totalXp"`
	FtpWatts int16  `json:"ftpWatts"`
	WeightKg int16  `json:"weightKg"`
	JoinedAt string `json:"joinedAt"`
}

type medalJSON struct {
	Kind      string `json:"kind"`
	Rider     string `json:"rider"`
	AwardedAt string `json:"awardedAt"`
}

type roomJSON struct {
	Slug   string `json:"slug"`
	Code   string `json:"code,omitempty"` // members only — the code IS the invite
	Name   string `json:"name"`
	Listed bool   `json:"listed"`
	// Emoji identity mark (#223) — public like the name.
	Icon string `json:"icon,omitempty"`
	// Owner-set cue set ('base' | 'silent') — members only, like the code.
	SoundPack string `json:"soundPack,omitempty"`
	// The room's reaction palette (#223) — members only, like the sound pack.
	Cheers []string `json:"cheers,omitempty"`
	// Secret calendar-feed token (#245) — members only, like the code.
	IcsToken string `json:"icsToken,omitempty"`
	// The caller's own role; empty when they are not a member.
	Role    string       `json:"role,omitempty"`
	Members []memberJSON `json:"members,omitempty"`
	// Recent medal history (#28) — members only, room-scoped like everything.
	Medals []medalJSON `json:"medals,omitempty"`
	// Crew streak and this month's collective kJ (#29) — cooperative pressure,
	// no individual numbers anywhere in it.
	StreakWeeks int   `json:"streakWeeks"`
	MonthKj     int64 `json:"monthKj"`
	// Planned rides (#116): the full upcoming list for members, and just the
	// next one for the list view — the nav shows where the action will be.
	Upcoming    []scheduledJSON `json:"upcoming,omitempty"`
	NextSession *nextJSON       `json:"nextSession,omitempty"`
	// List-view presence: how many members exist, plus everything live the hub
	// knows (#251) — connected riders, phase, voice, cameras, riding, and the
	// running session's name and elapsed. Members-only, room-scoped like every
	// live signal.
	MemberCount int `json:"memberCount,omitempty"`
	protocol.RoomPresence
}

// --- handlers ---

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to create a room.")
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 60 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A room name has to be 1-60 characters.", "name")
		return
	}
	// docs/SPEC.md ownership cap: 3 owned rooms; membership is uncapped and
	// deleting a room frees the slot. 409 — the state, not the request, refuses.
	if owned, err := s.store.Queries.CountOwnedRooms(r.Context(), user.ID); err == nil && owned >= maxOwnedRooms {
		httpx.WriteError(w, http.StatusConflict, "conflict",
			"You already own 3 rooms — delete one to open another.")
		return
	}

	// Slug and code both need uniqueness; retry on collision rather than
	// checking first — the constraint is the check.
	var room db.Room
	for attempt := 0; ; attempt++ {
		slug := slugify(req.Name)
		if attempt > 0 {
			slug += "-" + randomCode(4)
		}
		created, err := s.store.Queries.CreateRoom(r.Context(), db.CreateRoomParams{
			Code: randomCode(6), Slug: strings.ToLower(slug), Name: req.Name, OwnerID: user.ID,
		})
		if err == nil {
			room = created
			break
		}
		if isUniqueViolation(err) && attempt < 3 {
			continue
		}
		s.log.Error("room create failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The room could not be created. Try again.")
		return
	}

	err := s.store.Queries.CreateMembership(r.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: user.ID, Role: "owner",
	})
	if err != nil {
		s.log.Error("owner membership failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The room could not be created. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, roomJSON{
		Slug: room.Slug, Code: room.Code, Name: room.Name, Listed: room.Listed, Role: "owner",
	})
}

func (s *Service) handleMine(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	roomsList, err := s.store.Queries.ListUserRooms(r.Context(), user.ID)
	if err != nil {
		s.log.Error("list rooms failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your rooms could not be loaded.")
		return
	}
	out := make([]roomJSON, 0, len(roomsList))
	for _, room := range roomsList {
		entry := roomJSON{Slug: room.Slug, Name: room.Name, Listed: room.Listed, Icon: room.Icon, Role: room.Role}
		if count, err := s.store.Queries.CountRoomMembers(r.Context(), room.ID); err == nil {
			entry.MemberCount = int(count)
		}
		if s.presence != nil {
			entry.RoomPresence = s.presence.Presence(room.Slug)
		}
		if next, err := s.store.Queries.NextRoomSession(r.Context(), room.ID); err == nil {
			entry.NextSession = &nextJSON{
				WorkoutName: next.WorkoutName,
				StartsAt:    next.StartsAt.Time.Format(time.RFC3339),
			}
		}
		out = append(out, entry)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"rooms": out})
}

// handleGet renders differently by membership: members get everything (the
// code is the invite, so it stays inside the room); anyone else with the link
// gets just enough to decide to join. Metrics privacy is not at stake here —
// nothing live crosses this endpoint.
func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return
	}
	response := roomJSON{Slug: room.Slug, Name: room.Name, Listed: room.Listed, Icon: room.Icon}

	if user, signedIn := s.users.User(r); signedIn {
		// A banned viewer gets the outsider view — the join button tells them.
		if m, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{
			RoomID: room.ID, UserID: user.ID,
		}); err == nil && m.Role != "banned" {
			response.Role = m.Role
			response.Code = room.Code
			response.SoundPack = room.SoundPack
			response.Cheers = cheerSet(room.Cheers)
			response.IcsToken = room.IcsToken
			if rows, err := s.store.Queries.ListRoomUpcoming(r.Context(), room.ID); err == nil {
				for _, row := range rows {
					response.Upcoming = append(response.Upcoming, scheduledJSON{
						ID: store.UUIDString(row.ID), WorkoutName: row.WorkoutName,
						WorkoutJSON: string(row.WorkoutJson),
						StartsAt:    row.StartsAt.Time.Format(time.RFC3339), CreatedBy: row.CreatedBy,
					})
				}
			}
			members, err := s.store.Queries.ListRoomMembers(r.Context(), room.ID)
			if err != nil {
				s.log.Error("list members failed", "err", err, "room", room.Slug)
				httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be loaded.")
				return
			}
			for _, member := range members {
				// The ban list is a moderation surface, not roster gossip —
				// only the owner sees who is out.
				if member.Role == "banned" && m.Role != "owner" {
					continue
				}
				response.Members = append(response.Members, memberJSON{
					ID: store.UUIDString(member.ID), DisplayName: member.DisplayName,
					AvatarURL: member.AvatarUrl, AvatarPreset: member.AvatarPreset,
					Role: member.Role, TotalXp: member.TotalXp,
					FtpWatts: member.FtpWatts, WeightKg: member.WeightKg,
					JoinedAt: member.JoinedAt.Time.Format("2006-01-02"),
				})
			}
			if weeks, err := s.store.Queries.ListRoomRideWeeks(r.Context(), room.ID); err == nil {
				times := make([]time.Time, len(weeks))
				for i, w := range weeks {
					times[i] = w.Time
				}
				response.StreakWeeks = stats.WeekStreak(times, time.Now())
			}
			if kj, err := s.store.Queries.RoomMonthKj(r.Context(), room.ID); err == nil {
				response.MonthKj = kj
			}
			medals, err := s.store.Queries.ListRoomMedals(r.Context(), db.ListRoomMedalsParams{
				RoomID: room.ID, Limit: 24,
			})
			if err == nil {
				for _, medal := range medals {
					response.Medals = append(response.Medals, medalJSON{
						Kind: medal.Kind, Rider: medal.DisplayName,
						AwardedAt: medal.AwardedAt.Time.Format("2006-01-02"),
					})
				}
			}
		}
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

func (s *Service) handleJoin(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to join a room.")
	if !ok {
		return
	}
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return
	}
	if s.isBanned(r, room, user) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "The owner removed you from this room.")
		return
	}
	// Idempotent by design (ON CONFLICT DO NOTHING): joining twice is a no-op,
	// and an existing role is never downgraded to member by a re-join.
	err := s.store.Queries.CreateMembership(r.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: user.ID, Role: "member",
	})
	if err != nil {
		s.log.Error("join failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Joining did not work. Try again.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// isBanned is the join-time gate: a ban survives every re-join path because
// the membership row itself carries it.
func (s *Service) isBanned(r *http.Request, room db.Room, user db.User) bool {
	m, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{
		RoomID: room.ID, UserID: user.ID,
	})
	return err == nil && m.Role == "banned"
}

// handleJoinByCode resolves a 6-char code to its room and joins — the
// cross-device fallback when the link is on another screen.
func (s *Service) handleJoinByCode(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to join a room.")
	if !ok {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	room, err := s.store.Queries.GetRoomByCode(r.Context(), code)
	if err != nil {
		// Same shape for "no such code" and lookup errors: a code is a secret,
		// and this endpoint must not confirm which ones exist.
		httpx.WriteFieldError(w, http.StatusNotFound, "not_found",
			"No room has that code. Check it with whoever shared it.", "code")
		return
	}
	if s.isBanned(r, room, user) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "The owner removed you from this room.")
		return
	}
	err = s.store.Queries.CreateMembership(r.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: user.ID, Role: "member",
	})
	if err != nil {
		s.log.Error("join by code failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Joining did not work. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"slug": room.Slug})
}

// handleUpdate: owner-only per the matrix — "Edit room (name, listing)".
func (s *Service) handleUpdate(w http.ResponseWriter, r *http.Request) {
	room, user, ok := s.requireRole(w, r, "owner")
	if !ok {
		return
	}
	_ = user
	var req struct {
		Name      string    `json:"name"`
		Listed    bool      `json:"listed"`
		SoundPack string    `json:"soundPack"`
		Icon      *string   `json:"icon"`   // nil keeps, "" clears
		Cheers    *[]string `json:"cheers"` // nil keeps, [] resets to base
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 60 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A room name has to be 1-60 characters.", "name")
		return
	}
	if req.SoundPack == "" {
		req.SoundPack = room.SoundPack // absent field keeps the current pack
	}
	if req.SoundPack != "base" && req.SoundPack != "silent" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A sound pack is base or silent.", "soundPack")
		return
	}
	icon := room.Icon
	if req.Icon != nil {
		icon = strings.TrimSpace(*req.Icon)
		if icon != "" && !protocol.IsEmoji(icon) {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"A room icon is one emoji, or none.", "icon")
			return
		}
	}
	cheers := room.Cheers
	if req.Cheers != nil {
		if len(*req.Cheers) > maxCheers {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				fmt.Sprintf("A room speaks at most %d reactions.", maxCheers), "cheers")
			return
		}
		deduped := make([]string, 0, len(*req.Cheers))
		seen := map[string]struct{}{}
		for _, emoji := range *req.Cheers {
			if !protocol.IsEmoji(emoji) {
				httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
					"Reactions are single emoji.", "cheers")
				return
			}
			if _, dup := seen[emoji]; dup {
				continue
			}
			seen[emoji] = struct{}{}
			deduped = append(deduped, emoji)
		}
		cheers = strings.Join(deduped, " ") // "" = back to the base set
	}
	updated, err := s.store.Queries.UpdateRoom(r.Context(), db.UpdateRoomParams{
		ID: room.ID, Name: req.Name, Listed: req.Listed, SoundPack: req.SoundPack,
		Icon: icon, Cheers: cheers,
	})
	if err != nil {
		s.log.Error("room update failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be saved.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, roomJSON{
		Slug: updated.Slug, Code: updated.Code, Name: updated.Name, Icon: updated.Icon,
		Listed: updated.Listed, SoundPack: updated.SoundPack,
		Cheers: cheerSet(updated.Cheers), Role: "owner",
	})
}

// handleDelete: owner-only. Memberships and medals cascade with the room;
// rides survive with room_id set null — history stays each rider's own.
// ponytail: a live hub room drifts until its sockets close; nobody new can
// join a deleted room, so it dies of natural causes.
func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	room, _, ok := s.requireRole(w, r, "owner")
	if !ok {
		return
	}
	if err := s.store.Queries.DeleteRoom(r.Context(), room.ID); err != nil {
		s.log.Error("room delete failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be deleted. Try again.")
		return
	}
	s.log.Info("room deleted", "room", room.Slug)
	w.WriteHeader(http.StatusNoContent)
}

// handleSetRole: owner assigns or removes coach, bans, unbans (matrix:
// owner-only). A ban also severs the target's live sockets and voice.
func (s *Service) handleSetRole(w http.ResponseWriter, r *http.Request) {
	room, owner, ok := s.requireRole(w, r, "owner")
	if !ok {
		return
	}
	var req struct {
		UserID string `json:"userId"`
		Role   string `json:"role"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if req.Role != "coach" && req.Role != "member" && req.Role != "banned" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A role is coach, member or banned — ownership does not transfer here.", "role")
		return
	}
	target, err := store.ParseUUID(req.UserID)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a user id.", "userId")
		return
	}
	if store.UUIDString(target) == store.UUIDString(owner.ID) {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"You are the owner — that role does not change here.")
		return
	}
	err = s.store.Queries.UpdateMembershipRole(r.Context(), db.UpdateMembershipRoleParams{
		RoomID: room.ID, UserID: target, Role: req.Role,
	})
	if err != nil {
		s.log.Error("role update failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The role could not be changed.")
		return
	}
	if req.Role == "banned" {
		s.evict(room.Slug, req.UserID)
		s.log.Info("member banned", "room", room.Slug, "rider", req.UserID)
	} else if s.presence != nil {
		s.presence.SetRole(room.Slug, req.UserID, req.Role)
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRemoveMember: the owner removes anyone; anyone removes themselves
// (leaving). The owner cannot leave — a room without an owner has nobody who
// can edit or delete it, so ownership transfer is a future feature, not an
// accident of leaving.
func (s *Service) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return
	}
	target, err := store.ParseUUID(r.PathValue("userID"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That is not a user id.")
		return
	}

	self := store.UUIDString(target) == store.UUIDString(user.ID)
	if !self {
		if _, _, ok := s.requireRole(w, r, "owner"); !ok {
			return
		}
	}
	if room.OwnerID == target {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"The owner cannot leave their own room.")
		return
	}
	err = s.store.Queries.DeleteMembership(r.Context(), db.DeleteMembershipParams{
		RoomID: room.ID, UserID: target,
	})
	if err != nil {
		s.log.Error("remove member failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That did not work. Try again.")
		return
	}
	// Leaving or being removed ends the live connection too — a socket whose
	// membership is gone must not keep streaming until it happens to close.
	s.evict(room.Slug, store.UUIDString(target))
	w.WriteHeader(http.StatusNoContent)
}

// --- helpers ---

func (s *Service) roomBySlug(w http.ResponseWriter, r *http.Request) (db.Room, bool) {
	room, err := s.store.Queries.GetRoomBySlug(r.Context(), strings.ToLower(r.PathValue("slug")))
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No room lives at this link.")
		return db.Room{}, false
	}
	if err != nil {
		s.log.Error("room lookup failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be loaded.")
		return db.Room{}, false
	}
	return room, true
}

// requireRole loads the room and refuses unless the caller holds the role.
// 403, not 404: the link is shareable, so the room's existence is not a secret.
func (s *Service) requireRole(w http.ResponseWriter, r *http.Request, role string) (db.Room, db.User, bool) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return db.Room{}, db.User{}, false
	}
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return db.Room{}, db.User{}, false
	}
	m, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{
		RoomID: room.ID, UserID: user.ID,
	})
	if err != nil || m.Role != role {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Only the room's "+role+" can do that.")
		return db.Room{}, db.User{}, false
	}
	return room, user, true
}

// randomCode draws from an alphabet with no 0/O/1/I/L — codes get read out
// loud across a room over trainer noise.
func randomCode(length int) string {
	const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failing means the platform is broken
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
	slug := nonSlug.ReplaceAllString(strings.ToLower(name), "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		slug = "room"
	}
	if len(slug) > 40 {
		slug = slug[:40]
	}
	return slug
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// Authorize implements hub.Access: resolve the request's session to a user,
// then require membership in the slug's room. Checked once at connect — the
// hub never touches the database after that.
func (s *Service) Authorize(r *http.Request, slug string) (protocol.Rider, error) {
	user, ok := s.users.User(r)
	if !ok {
		return protocol.Rider{}, errNotMember
	}
	room, err := s.store.Queries.GetRoomBySlug(r.Context(), strings.ToLower(slug))
	if err != nil {
		return protocol.Rider{}, fmt.Errorf("rooms: authorize: %w", err)
	}
	m, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{
		RoomID: room.ID, UserID: user.ID,
	})
	if err != nil || m.Role == "banned" {
		return protocol.Rider{}, errNotMember
	}
	return protocol.Rider{
		ID:       store.UUIDString(user.ID),
		Name:     user.DisplayName,
		Role:     m.Role,
		FtpWatts: int(user.FtpWatts),
		WeightKg: int(user.WeightKg),
	}, nil
}

var errNotMember = errors.New("rooms: not a member")
