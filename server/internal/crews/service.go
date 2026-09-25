// Package crews is the crew (ADR-0038, ADR-0058): who is in it and what they
// are to it, its door and its directory entry, its picture and pins,
// its members' page, its schedule and its calendar feeds. Durable data only —
// what is live in a voice channel is the hub's, and the channels themselves
// are package channels'. The rooms it grew out of are gone (#2446).
package crews

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// UserSource is what crews needs from auth — defined here, where it is
// consumed, and satisfied by *auth.Service.
type UserSource interface {
	User(r *http.Request) (db.User, bool)
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// Presence is what crews borrows from the hub, which keys by voice channel
// (#2436). Optional: without it a ban cannot sever a live socket and nobody
// hears that anything changed until they reload.
type Presence interface {
	Kick(channel, userID string)
	// A plan is something the crew did (#359): planning over HTTP reaches
	// the timeline of the people standing in the channel it names.
	SessionAnnounce(channel, verb, actor, workout string, startsAt time.Time)
	// Something changed because somebody else changed it (#570) — the lobby
	// ping is how every other client hears, and re-fetches.
	PresenceChanged()
	// A planned session's start opens it in its voice channel (#2440), and
	// answers the channel's one-session rule: the session's id when it
	// opened, or a code and a message.
	OpenSession(channel string, rider protocol.Rider, workoutName, workoutJSON string) (id, code, message string)
}

// Gate is the channels' one gate, asked again (#2808). The door asks it once,
// at connect, so a crew role change or a hand-over has to reach the sockets
// and calls already open, once it has committed: a new admin or owner gets
// their controls there (#278), and a demoted admin leaves the private
// channels that do not name them. Satisfied by *channels.Service. Optional
// like the hub; without it nothing already open hears the change until it
// reconnects.
type Gate interface {
	Reauthorize(ctx context.Context, crewID, userID pgtype.UUID)
}

// VoiceEjector is the LiveKit arm of a kick — satisfied by *av.Service.
// Optional: without AV there is no voice to eject anyone from.
type VoiceEjector interface {
	Eject(channel, userID string)
}

// Notifier is what scheduling needs from notify (#117) — defined here, where
// it is consumed. Optional: without it planning a session emails nobody. A
// plan is the crew's (#2440): the mail names the crew and the voice channel
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
	gate     Gate
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

func New(st *store.Store, users UserSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log,
		doors: budget.New[string](doorGuessesPerWindow, doorWindow)}
}

// SetPresence wires the hub in after construction.
func (s *Service) SetPresence(p Presence) { s.presence = p }

// SetGate wires the channels' gate in, once the hub is behind it.
func (s *Service) SetGate(g Gate) { s.gate = g }

// SetVoiceEjector wires LiveKit ejection in when AV is configured.
func (s *Service) SetVoiceEjector(v VoiceEjector) { s.voice = v }

// SetNotifier wires session-planned email in when the server can send.
func (s *Service) SetNotifier(n Notifier) { s.notifier = n }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/schedule", s.handleMySchedule)
	mux.HandleFunc("GET /api/calendar/{token}", s.handleUserCalendar)
	mux.HandleFunc("POST /api/calendar/rotate", s.handleRotateUserIcs)
	mux.HandleFunc("GET /api/moved/r/{slug}", s.handleMovedRoom)
	s.registerCrews(mux)
	s.registerPins(mux)
}

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

// evict severs someone's live presence in one voice channel — metrics socket
// and voice. A ban must eject, not drift until the rider disconnects.
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

// reauthorize asks the gate again about riders whose crew role has just
// changed, in every voice channel of the crew. Only after the commit: it
// closes live sockets, which no rollback can reopen.
func (s *Service) reauthorize(ctx context.Context, crew pgtype.UUID, riders ...pgtype.UUID) {
	if s.gate == nil {
		return
	}
	for _, rider := range riders {
		s.gate.Reauthorize(ctx, crew, rider)
	}
}

// changed pings every lobby socket: something durable about a crew moved —
// its plan, its members, their roles, its name — and the clients showing it
// re-fetch (#251, #570).
// ponytail: one ping for everyone, not just this crew's members — the lobby
// has no per-crew routing yet, and a crew mutation is a rare event.
func (s *Service) changed() {
	if s.presence != nil {
		s.presence.PresenceChanged()
	}
}
