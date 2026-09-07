// Package hub owns all live room state in memory: one goroutine per room,
// clients join/leave over WebSocket, and rider metrics are coalesced into one
// tick message per room per second (see WATTROOM.md §3). Everything here dies
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
	Rider   protocol.Rider
	Samples []protocol.RiderMetrics
}

// SessionSaver persists a closed session's rides. Defined here, where it is
// consumed; stats.Saver implements it. Nil means "no database" and sessions
// simply stay in memory, as before. The implementation owns timeouts and
// retries and may block for minutes — the hub calls it from a goroutine.
type SessionSaver interface {
	SaveSession(ctx context.Context, slug, workoutName, workoutJSON string, startedAt time.Time, riders []RiderRecord)
}

// ChatKeeper persists chat and reactions (ADR-0010 amended, #201). Defined
// here, where it is consumed; the chat service implements it. Nil means "no
// database" — chat stays ephemeral, lines carry no id, reactions no-op.
type ChatKeeper interface {
	SaveChat(ctx context.Context, slug, userID, text, imageID string) (id string, ok bool)
	ToggleReaction(ctx context.Context, slug, messageID, userID, emoji string) (count int, added bool, ok bool)
}

// AutoplaySource answers what a room's autoplay should draw from (#627),
// read once per trigger — a rider joining an idle deck, or the deck running
// dry (#676) — and always outside the room's lock (server/AGENTS.md: DB I/O
// never happens while holding a room mutex). Defined here, where it is
// consumed; the playlists service implements it. Nil, or ok=false, means
// nothing to play: autoplay stays silent. fixed, if non-nil, is queued before
// tracks — tracks already carries whatever order (list order or shuffled) the
// caller's autoplay setting currently means.
type AutoplaySource interface {
	Autoplay(ctx context.Context, slug string) (fixed *protocol.JukeboxCommand, tracks []protocol.JukeboxCommand, ok bool)
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
	SprintWon(slug, riderID string, at time.Time)
	// A queued track reached its natural end; ref is unique to that play.
	TrackPlayed(slug, riderID, ref string, at time.Time)
	SessionClosed(ev SessionClosed)
}

// SessionClosed is one closed session as the keeper sees it: who rode, who
// was in voice for how long, and who pressed start.
type SessionClosed struct {
	Slug string
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
// are they in this room, and what is the room actually called. Defined here,
// where it is consumed; implemented by rooms.Service. The hub itself never
// touches the database — membership is checked once at connect, not per
// message. The returned slug is the room's canonical one: the request path is
// matched case-insensitively, and live state is keyed on the canonical slug so
// every casing of a link lands in the same room (#639).
type Access interface {
	Authorize(r *http.Request, slug string) (rider protocol.Rider, canonical string, err error)
}

type Hub struct {
	log    *slog.Logger
	access Access
	saver  SessionSaver
	now    func() time.Time
	mu     sync.Mutex
	rooms  map[string]*room
	// slug → identity → who; fed by LiveKit webhooks (#149) and reconciled
	// against LiveKit's own participant list (#234).
	voice map[string]map[string]voiceEntry
	chat  ChatKeeper
	xp    XpKeeper
	// What makes a finished session durable (ADR-0034). Nil = no database,
	// and a session leaves nothing.
	recaps RecapKeeper
	// The lobby (#251): every signed-in client holds one socket here; holding
	// it IS being online, and every presence change pings it. See lobby.go.
	lobby     map[*lobbyClient]string
	lobbyAuth func(*http.Request) (userID string, ok bool)
	// Chat persistence queue (#219): read loops enqueue, one worker saves.
	saves chan chatSave
	// Autoplay source and its trigger queue (#627): a join or a deck running
	// dry enqueues, one worker reads the room's active playlist and seeds
	// the deck.
	playlists AutoplaySource
	autoplays chan autoplayJob
}

// autoplayJob is one idle deck worth checking — enough to read the room's
// autoplay plan and hand it back to the room that asked.
type autoplayJob struct {
	rm   *room
	slug string
	// The deck ran dry rather than a rider joining (#676): the playlist
	// loops, the fixed start does not — SPEC calls it a start.
	loop bool
}

// chatSave is one line awaiting persistence — enough to save it and to
// address the follow-up ChatID back to its room.
type chatSave struct {
	rm      *room
	slug    string
	riderID string
	text    string
	imageID string
	at      int64
}

// SetChatKeeper wires persistence in after construction, like SetPresence's
// mirror on the rooms side — nil stays valid (ephemeral chat).
func (h *Hub) SetChatKeeper(k ChatKeeper) { h.chat = k }

// SetXpKeeper wires the trophy case in (#467) — before the first room
// opens, since rooms capture it at creation. Nil stays valid.
func (h *Hub) SetXpKeeper(k XpKeeper) { h.xp = k }

// SetPlaylistSource wires autoplay's read side in (#627), like SetChatKeeper.
// Nil stays valid — autoplay just never fires.
func (h *Hub) SetPlaylistSource(k AutoplaySource) { h.playlists = k }

func New(log *slog.Logger, access Access, saver SessionSaver) *Hub {
	h := &Hub{log: log, access: access, saver: saver, now: time.Now,
		rooms: make(map[string]*room), voice: make(map[string]map[string]voiceEntry),
		lobby: make(map[*lobbyClient]string),
		saves: make(chan chatSave, 256), autoplays: make(chan autoplayJob, 64)}
	// Supervised (#651): a poison job costs one log line and is skipped, not
	// the rest of the process's chat history or autoplay.
	safego.Supervise(log, h.now, "hub chat saver", nil, h.saveWorker)
	safego.Supervise(log, h.now, "hub autoplay worker", nil, h.autoplayWorker)
	h.registerRidingMetric()
	return h
}

// saveWorker drains the chat-persistence queue (#219): a stalled database
// backs up this queue, never a sender's read loop or any tick. Exits when
// the process does — the hub has no shutdown, it lives as long as the server.
// ponytail: one worker for the whole hub; per-room workers if a slow save
// ever lets one loud room starve the rest.
func (h *Hub) saveWorker() {
	for job := range h.saves {
		if id, ok := h.chat.SaveChat(context.Background(), job.slug, job.riderID, job.text, job.imageID); ok {
			job.rm.chatIDAssigned(protocol.ChatID{FromID: job.riderID, At: job.at, ID: id})
		}
	}
}

// autoplayWorker drains the autoplay-trigger queue (#627): a stalled
// database backs up this queue, never a joining rider's upgrade or any tick.
// Exits when the process does, like saveWorker.
// ponytail: one worker for the whole hub, same call as chat's.
func (h *Hub) autoplayWorker() {
	for job := range h.autoplays {
		fixed, tracks, ok := h.playlists.Autoplay(context.Background(), job.slug)
		if job.loop {
			fixed = nil
		}
		job.rm.applyAutoplay(fixed, tracks, ok, h.now())
	}
}

// triggerAutoplay checks a room's deck and, if it is idle, enqueues the DB
// read that decides what autoplay puts on it (#627). Fired by a join and by
// the deck running dry (#676, loop=true). The check-then-enqueue happens
// outside any I/O; the worker re-checks idle under the room's lock before
// seeding, so two riders joining the same instant cannot double-queue the
// room's playlist. Nothing here re-fires itself: a loop needs a real "ended"
// from a client each pass, and a source with nothing to play — autoplay off,
// an empty playlist — leaves the deck idle and the queue quiet.
func (h *Hub) triggerAutoplay(rm *room, slug string, loop bool) {
	if h.playlists == nil {
		return
	}
	rm.mu.Lock()
	idle := rm.music.state.Current == nil
	rm.mu.Unlock()
	if !idle {
		return
	}
	select {
	case h.autoplays <- autoplayJob{rm: rm, slug: slug, loop: loop}:
	default:
		// Full queue: the room just stays idle until the next join, which
		// will try again — better than a joining rider's upgrade or read
		// loop blocking.
		h.log.Warn("autoplay queue full, skipping", "room", slug)
	}
}

// Kick severs every socket a rider holds in slug — the live arm of a ban or
// removal (#223), which must eject, not drift. Lock, copy, unlock, then
// close: CloseNow unblocks the read loop, whose defer runs the leave.
func (h *Hub) Kick(slug, userID string) {
	h.mu.Lock()
	rm := h.rooms[slug]
	h.mu.Unlock()
	if rm == nil {
		return
	}
	rm.mu.Lock()
	var conns []*websocket.Conn
	for c := range rm.clients {
		if c.rider.ID == userID {
			conns = append(conns, c.conn)
		}
	}
	rm.mu.Unlock()
	for _, conn := range conns {
		_ = conn.CloseNow()
	}
	if len(conns) > 0 {
		h.log.Info("rider kicked", "room", slug, "rider", userID, "sockets", len(conns))
	}
}

// CloseRoom forgets everything live about a room, for a room that has been
// deleted (#618). Deleting the durable row freed the slug, and the hub went on
// holding the room's jukebox queue, chat buffer, session and roster — so the
// next room created under the same name opened carrying the dead room's state.
// Its members need not be the old room's members, which makes the inheritance
// a privacy-shaped surprise as well as a bug.
//
// Sever the sockets, stop the ticker, drop both maps keyed by the slug. A room
// re-created later starts from newRoom, and only HandleWS can bring one back —
// which authorizes against the database first, so a deleted slug cannot.
func (h *Hub) CloseRoom(slug string) {
	h.mu.Lock()
	rm := h.rooms[slug]
	delete(h.rooms, slug)
	// Voice is keyed by the same slug and outlives the sockets (#149); left
	// behind, it seeds the next room's roster from voiceRidersLocked.
	delete(h.voice, slug)
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
	// second CloseRoom for this slug reads a nil room and returns.
	close(rm.stop)
	rm.mu.Unlock()
	for _, conn := range conns {
		_ = conn.CloseNow()
	}
	h.log.Info("room closed", "room", slug, "sockets", len(conns))
}

// SetRole re-roles a rider's live sockets in place (#278 rider report): the
// rider struct is captured when the socket opens, so a promotion to coach
// reached neither the control check nor anyone's roster until the promoted
// rider happened to reconnect.
func (h *Hub) SetRole(slug, userID, role string) {
	h.mu.Lock()
	rm := h.rooms[slug]
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

// Presence answers "is anything happening in there" for the rooms list and
// the rail (#39 design: the nav shows where the action is) — and now who,
// so a rider can see their crew from any page. Riders, not sockets: a phone
// spectator next to a desktop is one person. Lock, copy, unlock.
// SessionAnnounce puts one plan line on a room's live timeline (#359).
// Planning is an HTTP call, but the people standing in the room are the ones
// it is about. Only a room that already exists gets the line: spinning one up
// for a line nobody is there to read would leak a ticker per planned session.
func (h *Hub) SessionAnnounce(slug, verb, actor, workout string, startsAt time.Time) {
	h.mu.Lock()
	rm, live := h.rooms[slug]
	h.mu.Unlock()
	if !live {
		return
	}
	at := h.now()
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.events.add(sessionLine(verb, actor, workout, startsAt, at), at)
}

// QueuePlaylist appends a saved playlist's tracks onto a room's live queue
// (#627) — a rider pressed "queue" from the playlists panel, which is a plain
// HTTP call like PostChat, not a WS command. Returns false when nobody is
// connected to seed a deck for; the caller (who is presumably looking at
// this room's jukebox right now) should not normally see that. addedCount is
// how many tracks actually landed, for the response — the queue's own caps
// (jukebox.go's maxQueue/maxQueuedTracks) can stop it short.
func (h *Hub) QueuePlaylist(slug, riderID, addedBy string, tracks []protocol.JukeboxCommand) (addedCount int, ok bool) {
	rm := h.occupied(slug)
	if rm == nil {
		return 0, false
	}
	now := h.now()
	for _, cmd := range tracks {
		if _, added := rm.jukebox(cmd, riderID, addedBy, now); !added {
			break // cap hit or a bad entry slipped through — stop, don't skip holes
		}
		addedCount++
	}
	return addedCount, true
}

func (h *Hub) room(slug string) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	rm, ok := h.rooms[slug]
	if !ok {
		rm = newRoom(slug)
		rm.changed = h.PresenceChanged
		rm.deckIdled = func() { h.triggerAutoplay(rm, slug, true) }
		rm.xp = h.xp
		rm.recaps = h.recaps
		// Voice can be live before the first socket opens the room — seed
		// it, unlocked: nobody else can hold this room yet.
		rm.voiceNow = h.voiceRidersLocked(slug)
		h.rooms[slug] = rm
		h.launchRoom(rm)
	}
	return rm
}

// launchRoom starts the room's tick loop under supervision (#651): a panic
// in one tick — game mode, jukebox, session close — is logged with its stack
// and the loop relaunched, so the clock never stays dead on the riders'
// screens while every other room rides on. Bounded by safego's budget.
//
// Once that budget is spent the loop is gone for good, and a room with no
// clock is worse than no room: the sockets stay open and every rider watches
// a timer that will never move again (#751). Close it instead — the clients
// reconnect, and the join builds a fresh room with a live loop.
func (h *Hub) launchRoom(rm *room) {
	safego.SuperviseThen(h.log, h.now, "room "+rm.slug, rm.stop,
		func() { rm.run(h.log, h.now, h.saver) },
		func() { h.CloseRoom(rm.slug) })
}
