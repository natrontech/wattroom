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
//
// The hub keys by voice channel (#2436): every method takes the room's voice
// channel id, which s.store.VoiceChannelOf resolves — "" for a room without
// one, which the hub reads as a channel nobody is in.
type Presence interface {
	Presence(channel string) protocol.RoomPresence
	Kick(channel, userID string)
	// A crew role change has to reach the sockets that are already open, or
	// a new admin stays refused until they reconnect.
	SetRole(channel, userID, role string)
	// The plan is something the room did (#359): planning over HTTP has to
	// reach the timeline of the people standing in the room right now.
	SessionAnnounce(channel, verb, actor, workout string, startsAt time.Time)
	// A room changes because somebody else changed it (#570) — the lobby
	// ping is how every other client hears, and re-fetches.
	PresenceChanged()
	// A deleted room's live state has to die with it (#618).
	CloseRoom(channel string)
	// A planned session's start opens it in its voice channel (#2440), and
	// answers the channel's one-session rule: a code and a message, or two
	// empty strings when it opened.
	OpenSession(channel string, rider protocol.Rider, workoutName, workoutJSON string) (code, message string)
}

// VoiceEjector is the LiveKit arm of a kick — satisfied by *av.Service.
// Optional: without AV there is no voice to eject anyone from.
type VoiceEjector interface {
	Eject(channel, userID string)
}

// Notifier is what scheduling needs from notify (#117) — defined here, where
// it is consumed. Optional: without it planning a session emails nobody.
//
// A plan is the crew's (#2440): the mail names the crew and the voice channel
// the plan names, which is invalid while it names none.
type Notifier interface {
	SessionPlanned(crew, channel pgtype.UUID, workoutName string, startsAt time.Time, planner pgtype.UUID)
	SessionRescheduled(crew, channel pgtype.UUID, workoutName string, startsAt time.Time, planner pgtype.UUID)
	SessionCancelled(crew, channel pgtype.UUID, workoutName string, startsAt time.Time, actor pgtype.UUID)
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
func (s *Service) evict(channel, userID string) {
	if channel == "" {
		return
	}
	if s.presence != nil {
		s.presence.Kick(channel, userID)
	}
	if s.voice != nil {
		s.voice.Eject(channel, userID)
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
	mux.HandleFunc("POST /api/rooms/{slug}/schedule/{id}/started", s.handleSessionStarted)
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
	s.registerPins(mux)
	s.registerAnnouncement(mux)
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
	// A role row does not outrank a ban (#1763): the crew-ban sweep that
	// takes the row can fail and is only logged, so ask isBanned here too,
	// as RequireMember does.
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		// The database did not answer (#1984): not a refusal.
		httpx.Fail(w, s.log, "membership lookup", err, "The room could not be checked. Try again.", "room", room.Slug)
		return db.Room{}, db.User{}, false
	}
	if err != nil || m.Role != role || s.isBanned(r, room, user) {
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
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		// The database did not answer (#1984): not a refusal.
		httpx.Fail(w, s.log, "membership lookup", err, "The room could not be checked. Try again.", "room", room.Slug)
		return db.Room{}, db.User{}, false
	}
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
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		// The database did not answer (#1984): not a refusal.
		httpx.Fail(w, s.log, "membership lookup", err, "The room could not be checked. Try again.", "room", room.Slug)
		return db.Room{}, db.User{}, false
	}
	if err != nil || (m.Role != "owner" && m.Role != "coach") || s.isBanned(r, room, user) {
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
