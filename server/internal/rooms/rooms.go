// Package rooms is persistent rooms (#17): create, join via link or code,
// roles per the docs/SPEC.md matrix. Durable data only — everything live
// (ticks, timers, presence) stays in the hub (#18).
package rooms

import (
	"crypto/rand"
	"errors"
	"github.com/natrontech/wattroom/server/internal/budget"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"fmt"

	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// UserSource is what rooms needs from auth — defined here, where it is
// consumed, and satisfied by *auth.Service.
type UserSource interface {
	User(r *http.Request) (db.User, bool)
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
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
	// The plan is something the room did (#359): planning over HTTP has to
	// reach the timeline of the people standing in the room right now.
	SessionAnnounce(slug, verb, actor, workout string, startsAt time.Time)
	// A room changes because somebody else changed it (#570) — the lobby
	// ping is how every other client hears, and re-fetches.
	PresenceChanged()
	// A deleted room's live state has to die with it (#618): the slug is
	// freed by the delete, and the next room to take it would otherwise
	// open holding the old room's queue, chat and session.
	CloseRoom(slug string)
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
	SessionCancelled(room db.Room, workoutName string, startsAt time.Time, actor pgtype.UUID)
}

type Service struct {
	store    *store.Store
	users    UserSource
	log      *slog.Logger
	presence Presence
	notifier Notifier
	voice    VoiceEjector
	// Guesses at a crew code per address (#1673): the door and the join were
	// unmetered over a 31^6 space, and every hit is a real crew join. The
	// sign-in ceiling, because the door is a sign-in-shaped surface.
	doors *budget.Budget[string]
}

const (
	doorGuessesPerWindow = 30
	doorWindow           = time.Minute
)

// throttleDoor answers 429 and reports true when this address has spent its
// window of guesses. A nil budget (a bare test service) never throttles.
func (s *Service) throttleDoor(w http.ResponseWriter, r *http.Request) bool {
	if s.doors == nil || s.doors.Spend(httpx.ClientIP(r)) {
		return false
	}
	httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
		"Too many crew codes tried from this address — wait a minute and try again.")
	return true
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

// changed pings every lobby socket: something durable about a room moved —
// its plan, its members, their roles, its name — and the clients showing it
// re-fetch (#251, #570). The ping carries no data, so it costs a room
// mutation nothing to be honest about it.
// ponytail: one ping for every room, not just this room's members — the
// lobby has no per-room routing, and a room mutation is a rare event.
func (s *Service) changed() {
	if s.presence != nil {
		s.presence.PresenceChanged()
	}
}

// SetNotifier wires session-planned email in when the server can send.
func (s *Service) SetNotifier(n Notifier) { s.notifier = n }

func New(st *store.Store, users UserSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log,
		doors: budget.New[string](doorGuessesPerWindow, doorWindow)}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/rooms", s.handleCreate)
	mux.HandleFunc("GET /api/rooms", s.handleMine)
	mux.HandleFunc("GET /api/rooms/directory", s.handleDirectory)
	mux.HandleFunc("GET /api/rooms/{slug}", s.handleGet)
	mux.HandleFunc("PATCH /api/rooms/{slug}", s.handleUpdate)
	mux.HandleFunc("DELETE /api/rooms/{slug}", s.handleDelete)
	mux.HandleFunc("POST /api/rooms/{slug}/schedule", s.handleSchedule)
	mux.HandleFunc("PATCH /api/rooms/{slug}/schedule/{id}", s.handleReschedule)
	mux.HandleFunc("DELETE /api/rooms/{slug}/schedule/{id}", s.handleUnschedule)
	mux.HandleFunc("PUT /api/rooms/{slug}/schedule/{id}/rsvp", s.handleRsvp)
	mux.HandleFunc("DELETE /api/rooms/{slug}/schedule/{id}/rsvp", s.handleRsvp)
	mux.HandleFunc("GET /api/rooms/{slug}/calendar/{token}", s.handleCalendar)
	mux.HandleFunc("POST /api/rooms/{slug}/calendar/rotate", s.handleRotateIcs)
	mux.HandleFunc("GET /api/schedule", s.handleMySchedule)
	mux.HandleFunc("GET /api/calendar/{token}", s.handleUserCalendar)
	mux.HandleFunc("POST /api/calendar/rotate", s.handleRotateUserIcs)
	mux.HandleFunc("POST /api/rooms/{slug}/join", s.handleJoin)
	mux.HandleFunc("PATCH /api/rooms/{slug}/me", s.handleSetMyPrefs)
	mux.HandleFunc("POST /api/rooms/{slug}/role", s.handleSetRole)
	mux.HandleFunc("DELETE /api/rooms/{slug}/members/{userID}", s.handleRemoveMember)
	s.registerCrews(mux)
	s.registerGrants(mux)
	mux.HandleFunc("POST /api/rooms/{slug}/transfer", s.handleTransferRoom)
}

func (s *Service) roomBySlug(w http.ResponseWriter, r *http.Request) (db.Room, bool) {
	room, err := s.store.Queries.GetRoomBySlug(r.Context(), strings.ToLower(r.PathValue("slug")))
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No room lives at this link.")
		return db.Room{}, false
	}
	if err != nil {
		httpx.Fail(w, s.log, "room lookup failed", err, "The room could not be loaded.")
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

// RequireMember loads the room at {slug} and refuses unless the caller is a
// member of any role — the one gate every room-scoped surface (chat,
// playlists, RSVP) stands behind (#638). A banned rider holds a row, not a
// membership, so the ban is refused here the same way the socket refuses it.
// Since ADR-0038 that includes a ban one level up: a crew ban reaches every
// room in the crew, and isBanned asks both levels as one question.
// refusal is the 403 copy, phrased for the surface asking.
func (s *Service) RequireMember(w http.ResponseWriter, r *http.Request, refusal string) (db.Room, db.User, bool) {
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
	if err != nil || m.Role == "banned" || s.isBanned(r, room, user) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", refusal)
		return db.Room{}, db.User{}, false
	}
	return room, user, true
}

// RequireModerator loads the room and refuses unless the caller is its owner
// or coach — the gate the genuinely destructive room-state verbs stand
// behind (#695): joining from a link makes you a member, and a member can
// use the room's shared jukebox and timeline but not tear either down.
// refusal is the 403 copy, phrased for the surface asking.
func (s *Service) RequireModerator(w http.ResponseWriter, r *http.Request, refusal string) (db.Room, db.User, bool) {
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
	if err != nil || (m.Role != "owner" && m.Role != "coach") {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", refusal)
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
	// Rejection sampling (#1673): 256 mod 31 is 8, so a plain modulo drew
	// the first eight letters 9/256 of the time and the rest 8/256.
	const unbiased = 256 - 256%len(alphabet)
	for i := range b {
		for int(b[i]) >= unbiased {
			if _, err := rand.Read(b[i : i+1]); err != nil {
				panic(err)
			}
		}
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

// Authorize implements hub.Access (and av.Access): resolve the request's
// session to a user, then require membership in the slug's room. Checked once
// at connect — the hub never touches the database after that. It hands back the
// room's canonical slug alongside the rider: the request slug is matched
// case-insensitively, so callers key live state on the returned slug, never on
// the string they passed in — otherwise `MyRoom` and `myroom` fork two live
// rooms that Kick and CloseRoom cannot both reach (#639).
func (s *Service) Authorize(r *http.Request, slug string) (protocol.Rider, string, error) {
	user, ok := s.users.User(r)
	if !ok {
		return protocol.Rider{}, "", av.ErrNoSession
	}
	room, err := s.store.Queries.GetRoomBySlug(r.Context(), strings.ToLower(slug))
	if err != nil {
		return protocol.Rider{}, "", fmt.Errorf("rooms: authorize: %w", err)
	}
	m, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{
		RoomID: room.ID, UserID: user.ID,
	})
	if err != nil || m.Role == "banned" || s.isBanned(r, room, user) {
		return protocol.Rider{}, "", errNotMember
	}
	// The level rides along with the rest of the room-visible identity
	// (#690). Authorize runs once per socket, not per tick, so the extra
	// read costs a join; a rider whose XP cannot be read joins at zero
	// rather than failing to join at all.
	xp, err := s.store.Queries.UserTotalXp(r.Context(), user.ID)
	if err != nil {
		s.log.Warn("total xp unavailable for roster", "err", err, "room", room.Slug)
		xp = 0
	}
	return protocol.Rider{
		ID:       store.UUIDString(user.ID),
		Name:     user.DisplayName,
		Role:     m.Role,
		FtpWatts: int(user.FtpWatts),
		WeightKg: int(user.WeightKg),
		TotalXp:  xp,
	}, room.Slug, nil
}

var errNotMember = errors.New("rooms: not a member")
