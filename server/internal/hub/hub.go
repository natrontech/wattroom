// Package hub owns all live voice-channel state in memory (ADR-0058): one
// goroutine per channel (its `channelState`, #3357), clients
// join/leave over WebSocket, and rider metrics are coalesced into one tick
// message per channel per second (see WATTROOM.md §3). Everything here dies
// with the process — durable data is the store's problem.
package hub

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
)

// RiderRecord is one rider's finished session, handed to the saver.
type RiderRecord struct {
	Rider protocol.Rider
	// In timeline order (#2814).
	Samples []protocol.RiderMetrics
	// When this rider's ride began: the timeline's start plus their first
	// second (#2814), which is not the session's for a rider who joined late.
	StartedAt time.Time
}

// SessionSaver persists a closed session's rides. Defined here, where it is
// consumed; stats.Saver implements it. Nil means "no database" and sessions
// simply stay in memory, as before. The implementation owns timeouts and
// retries and may block for minutes — the hub calls it from a goroutine.
type SessionSaver interface {
	// session is the closed session's id (#2438); rides name it (#2443).
	SaveSession(ctx context.Context, channel, session, workoutName, workoutJSON string, startedAt time.Time, riders []RiderRecord)
	// AmendRide hands over one rider's record again, longer than at the
	// close (#1536): a socket that dropped before the end and replayed its
	// buffer after it. The saver grows the saved ride from it, or does
	// nothing if there was no ride to grow.
	AmendRide(ctx context.Context, channel, session, workoutName, workoutJSON string, startedAt time.Time, rider RiderRecord)
}

// MinRideSamples is the saver's threshold: fewer than a minute of samples is
// a misclick, not a ride — the same rule the client's crash recovery uses.
const MinRideSamples = 60

// XpKeeper hears what a room did that earns XP or counts toward an
// achievement (#467). Defined here, where it is consumed; the gamify service
// implements it. Every call happens outside the hub's locks and must return
// at once — the keeper queues its own I/O. Nil means no gamification.
type XpKeeper interface {
	// The podium's first place, once per scored sprint moment.
	SprintWon(channel, riderID string, at time.Time)
	// The podium's first place, once per finished game (#1575).
	GameWon(channel, riderID, mode string, at time.Time)
	// A queued track reached its natural end; ref is unique to that play.
	TrackPlayed(channel, riderID, ref string, at time.Time)
	SessionClosed(ev SessionClosed)
}

// SessionClosed is one closed session as the keeper sees it: who rode, who
// was in voice for how long, and who pressed start.
type SessionClosed struct {
	Channel string
	// The session's id (#2438): what the ledger keys the session's XP by.
	SessionID string
	// Rider id of whoever pressed start; empty when the room came back from
	// a restart with the session already running.
	StartedBy string
	// The timeline's running seconds — pauses excluded, like Elapsed.
	Seconds int
	At      time.Time
	Riders  []SessionRider
}

// SessionRider is one person the session saw — on a bike, in voice, or both.
type SessionRider struct {
	ID string
	// At least MinRideSamples samples: a ride the saver keeps.
	Rode bool
	// Seconds in the voice channel while the timeline ran.
	VoiceSeconds int
}

// Access is what the hub needs from the durable side: who is this request,
// may they enter this voice channel, and what is its id actually spelled.
// Defined here, where it is consumed; implemented by channels.Service through
// its one gate, mayEnter (ADR-0058). The hub itself never touches the
// database — the gate is asked once at connect, not per message. The returned
// id is the canonical one: live state is keyed on it, so every casing of a
// link lands in the same room (#639).
type Access interface {
	Authorize(r *http.Request, channel string) (rider protocol.Rider, canonical string, err error)
}

type Hub struct {
	log    *slog.Logger
	access Access
	saver  SessionSaver
	now    func() time.Time
	// What every socket's writer pings on (keepalive.go). A field, like now,
	// so a test can shorten it for one hub.
	keepalive keepalive
	mu        sync.Mutex
	states    map[string]*channelState
	// Session saves and recaps in flight: fire-and-forget from the tick, but
	// not from the process — Drain waits on them before the server exits
	// (audit 2026-09-09).
	handoffs sync.WaitGroup
	// channel → identity → who; fed by LiveKit webhooks (#149) and reconciled
	// against LiveKit's own participant list (#234).
	voice map[string]map[string]voiceEntry
	xp    XpKeeper
	// Who a hub-born change concerns (#2324); nil tells everyone.
	audiences Audiences
	hider     Hider
	// What makes a finished session durable (ADR-0034). Nil = no database,
	// and a session leaves nothing.
	recaps RecapKeeper
	// The lobby (#251): every signed-in client holds one socket here; holding
	// it IS being online, and every presence change pings it. See lobby.go.
	lobby     map[*lobbyClient]string
	lobbyAuth func(*http.Request) (userID string, ok bool)
	// Which session a request rides on, and LiveKit's half of ending one
	// (#2807). See drop.go.
	sessionKey func(*http.Request) []byte
	ejector    VoiceEjector
	// Rooms a socket is arriving at or standing in, by channel (#2297): the
	// claim the idle sweep refuses to forget a room under. Held from before
	// HandleWS is handed the room until after its client has left it, so a
	// room with no clients and no holds has none coming either.
	holds map[string]int
	// Open sockets per rider, room and lobby together (#1415): each costs a
	// goroutine pair and a walk of the lobby under h.mu on join and leave,
	// and one account could open any number.
	sockets map[string]int
	// Autoplay source and its trigger queue (#627): a join or a deck running
	// dry enqueues, one worker reads the room's active playlist and seeds
	// the deck.
	playlists AutoplaySource
	history   TrackHistory
	autoplays chan autoplayJob
}

// SetXpKeeper wires the trophy case in (#467) — before the first room
// opens, since rooms capture it at creation. Nil stays valid.
func (h *Hub) SetXpKeeper(k XpKeeper) { h.xp = k }

func New(log *slog.Logger, access Access, saver SessionSaver) *Hub {
	h := &Hub{log: log, access: access, saver: saver, now: time.Now,
		keepalive: keepalive{every: socketKeepalive, pong: socketPingTimeout},
		states:    make(map[string]*channelState), voice: make(map[string]map[string]voiceEntry),
		lobby: make(map[*lobbyClient]string), sockets: make(map[string]int),
		holds:     make(map[string]int),
		autoplays: make(chan autoplayJob, 64)}
	// Supervised (#651): a poison job costs one log line and is skipped, not
	// the rest of the process's autoplay.
	safego.Supervise(log, h.now, "hub autoplay worker", nil, h.autoplayWorker)
	h.registerRideGauges()
	return h
}

// CloseChannel forgets everything live about a voice channel that has been
// deleted (#618): left behind, its jukebox queue, chat buffer, session and
// roster outlive the channel, and nobody should inherit a dead channel's state.
//
// Sever the sockets, stop the ticker, drop both maps keyed by the channel. Only
// HandleWS can bring one back — which authorizes against the database first,
// so a deleted channel cannot.
func (h *Hub) CloseChannel(channel string) {
	h.mu.Lock()
	rm := h.states[channel]
	delete(h.states, channel)
	// Voice is keyed by the same channel and outlives the sockets (#149); left
	// behind, it seeds the next room's roster from voiceRidersLocked.
	delete(h.voice, channel)
	h.mu.Unlock()
	if rm == nil {
		return
	}
	rm.mu.Lock()
	conns := make([]*websocket.Conn, 0, len(rm.clients))
	for c := range rm.clients {
		conns = append(conns, c.conn)
	}
	// Safe exactly once: the map delete above happened under h.mu, so a
	// second CloseChannel for this channel reads a nil room and returns.
	close(rm.stop)
	rm.mu.Unlock()
	for _, conn := range conns {
		_ = conn.CloseNow()
	}
	h.log.Info("room closed", "channel", channel, "sockets", len(conns))
}

// SetRole re-roles a rider's live sockets in place (#278 rider report): the
// rider struct is captured when the socket opens, so a promotion to coach
// reached neither the control check nor anyone's roster until the promoted
// rider happened to reconnect.
func (h *Hub) SetRole(channel, userID, role string) {
	h.mu.Lock()
	rm := h.states[channel]
	h.mu.Unlock()
	if rm == nil {
		return
	}
	rm.mu.Lock()
	for c := range rm.clients {
		if c.rider.ID == userID {
			c.rider.Role = role
		}
	}
	if seen, ok := rm.seen[userID]; ok {
		seen.Role = role
		rm.seen[userID] = seen
	}
	rm.mu.Unlock()
}

// SessionAnnounce puts one plan line on a room's live timeline (#359).
// Planning is an HTTP call, but the people standing in the room are the ones
// it is about. Only a room that already exists gets the line: spinning one up
// for a line nobody is there to read would leak a ticker per planned session.
func (h *Hub) SessionAnnounce(channel, verb, actor, workout string, startsAt time.Time) {
	h.mu.Lock()
	rm, live := h.states[channel]
	h.mu.Unlock()
	if !live {
		return
	}
	at := h.now()
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.events.add(sessionLine(verb, actor, workout, startsAt, at), at)
}

// OpenSession starts a planned session in a voice channel for rider (#2440):
// the pick a plan's start stands for, then the countdown — the pair the
// pre-M9 client sent over the socket, and a pick alone left the plan spent
// with nothing running (#2535). The channel's one-session rule answers
// exactly as it does on the socket — conflict, naming the coach (#2438). This
// plan already under way there with the rider coaching counts as started, so
// a second press is not refused its own ride; a different workout of theirs
// under way is not, and says so rather than marking a plan that never loaded
// (#2606). Their own pick left idle gives way to the plan. The channel's room
// is made if nobody is in it yet: the coach is on their way, and a countdown
// nobody comes to ride ends like any other. The id is the session's, so the
// starter can be taken to it (#2599); empty with a refusal.
func (h *Hub) OpenSession(channel string, rider protocol.Rider, workoutName, workoutJSON string) (id, code, message string) {
	rm := h.stateOf(channel)
	rm.mu.Lock()
	s := rm.session
	underWay := s.open() && s.coach == rider.ID && s.phase != "idle"
	current, running := s.workoutName, s.id
	rm.mu.Unlock()
	if underWay && current == workoutName {
		return running, "", ""
	}
	if underWay {
		return "", "conflict", "You're already riding " + current + " in this channel — end it before starting " + workoutName + "."
	}
	for _, c := range []protocol.Control{
		{Action: "pick", WorkoutName: workoutName, WorkoutJSON: workoutJSON},
		{Action: "start"},
	} {
		if code, message := rm.control(c, rider, h.now()); code != "" {
			return "", code, message
		}
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.session.id, "", ""
}

// liveChannels copies the hub's room pointers and lets the hub's lock go, so a
// caller then takes one room's lock at a time and never holds both: the lock
// order every read across rooms keeps, and why a metrics scrape cannot wedge
// a tick.
func (h *Hub) liveChannels() []*channelState {
	h.mu.Lock()
	defer h.mu.Unlock()
	rooms := make([]*channelState, 0, len(h.states))
	for _, rm := range h.states {
		rooms = append(rooms, rm)
	}
	return rooms
}

func (h *Hub) stateOf(channel string) *channelState {
	h.mu.Lock()
	defer h.mu.Unlock()
	rm, ok := h.states[channel]
	if !ok {
		rm = newChannelState(channel)
		// One clock for the room and the hub that owns it. newChannelState defaults to
		// time.Now, which is identical in production and divergent the moment
		// either is injected: join/leave/setAway/setMetrics/fire stamp on the
		// room's, run/sayDepartedLocked/rm.allow on the hub's, so a departure
		// landed in the future of the grace window measuring it. Captured like
		// safego.Supervise captures it in New — h.now is set once, before any
		// room exists, and a later write races every room goroutine reading it.
		rm.now = h.now
		rm.pending = &h.handoffs
		rm.changed = func(riders []string) { h.tellChannel(channel, riders...) }
		rm.deckIdled = func() { h.triggerAutoplay(rm, channel) }
		rm.deckPlayed = func(ev trackEvent) { h.recordTrackEvent(channel, ev) }
		rm.forget = func() bool { return h.forgetChannel(rm) }
		rm.xp = h.xp
		rm.hider = h.hider
		rm.recaps = h.recaps
		// Voice can be live before the first socket opens the room — seed
		// it, unlocked: nobody else can hold this room yet.
		rm.voiceNow = h.voiceRidersLocked(channel)
		h.states[channel] = rm
		h.launchChannel(rm)
		// Its "just played" from the log (#1432), on the worker: a DB read
		// never happens under a lock, and a full queue simply leaves the
		// history empty until the room plays something.
		if h.history != nil {
			select {
			case h.autoplays <- autoplayJob{rm: rm, channel: channel, seed: true}:
			default:
			}
		}
	}
	return rm
}

// Drain waits up to timeout for every session save and recap the ticks have
// handed off, and reports whether they all finished. The deploy replaces the
// container the moment the riding gauge drops — which is the moment a
// session ends and its save starts retrying — so the process has to wait for
// its own hand-offs or the whole room's rides go with it (audit 2026-09-09).
func (h *Hub) Drain(timeout time.Duration) bool {
	done := make(chan struct{})
	go func() {
		h.handoffs.Wait()
		close(done)
	}()
	select {
	case <-done:
		return true
	case <-time.After(timeout):
		return false
	}
}

// launchChannel starts the room's tick loop under supervision (#651): a panic
// in one tick — game mode, jukebox, session close — is logged with its stack
// and the loop relaunched, so the clock never stays dead on the riders'
// screens while every other room rides on. Bounded by safego's budget.
//
// Once that budget is spent the loop is gone for good, and a room with no
// clock is worse than no room: the sockets stay open and every rider watches
// a timer that will never move again (#751). Close it instead — the clients
// reconnect, and the join builds a fresh room with a live loop.
func (h *Hub) launchChannel(rm *channelState) {
	safego.SuperviseThen(h.log, h.now, "room "+rm.channel, rm.stop,
		func() { rm.run(h.log, h.now, h.saver) },
		func() { h.CloseChannel(rm.channel) })
}
