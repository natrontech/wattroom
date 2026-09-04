// Package hub owns all live room state in memory: one goroutine per room,
// clients join/leave over WebSocket, and rider metrics are coalesced into one
// tick message per room per second (see WATTROOM.md §3). Everything here dies
// with the process — durable data is the store's problem.
package hub

import (
	"context"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/protocol"
)

const tickInterval = time.Second

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
// read once per trigger — a rider joining an idle deck — and always outside
// the room's lock (server/AGENTS.md: DB I/O never happens while holding a
// room mutex). Defined here, where it is consumed; the playlists service
// implements it. Nil, or ok=false, means nothing to play: autoplay stays
// silent. fixed, if non-nil, is queued before tracks — tracks already
// carries whatever order (list order or shuffled) the caller's autoplay
// setting currently means.
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
// and are they in this room. Defined here, where it is consumed; implemented
// by rooms.Service. The hub itself never touches the database — membership is
// checked once at connect, not per message.
type Access interface {
	Authorize(r *http.Request, slug string) (protocol.Rider, error)
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
	// The lobby (#251): every signed-in client holds one socket here; holding
	// it IS being online, and every presence change pings it. See lobby.go.
	lobby     map[*lobbyClient]string
	lobbyAuth func(*http.Request) (userID string, ok bool)
	// Chat persistence queue (#219): read loops enqueue, one worker saves.
	saves chan chatSave
	// Autoplay source and its trigger queue (#627): a join enqueues, one
	// worker reads the room's active playlist and seeds the deck.
	playlists AutoplaySource
	autoplays chan autoplayJob
}

// autoplayJob is one idle deck worth checking — enough to read the room's
// autoplay plan and hand it back to the room that asked.
type autoplayJob struct {
	rm   *room
	slug string
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

// voiceEntry remembers when the join was reported, so a reconcile sweep
// cannot prune a rider who joined after its snapshot was taken — and whether
// their camera is live (#251, track_published).
type voiceEntry struct {
	// One entry per LiveKit connection, keyed by identity — a rider with two
	// tabs open holds two (#293), so a leave from one must not blank the
	// other. `rider` is who they all belong to.
	rider    string
	name     string
	joinedAt time.Time
	camera   bool
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
	go h.saveWorker()
	go h.autoplayWorker()
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
		job.rm.applyAutoplay(fixed, tracks, ok, h.now())
	}
}

// triggerAutoplay checks a just-joined room's deck and, if it is idle,
// enqueues the DB read that decides what autoplay puts on it (#627). The
// check-then-enqueue happens outside any I/O; the worker re-checks idle
// under the room's lock before seeding, so two riders joining the same
// instant cannot double-queue the room's playlist.
func (h *Hub) triggerAutoplay(rm *room, slug string) {
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
	case h.autoplays <- autoplayJob{rm: rm, slug: slug}:
	default:
		// Full queue: the room just stays idle until the next join, which
		// will try again — better than a joining rider's upgrade blocking.
		h.log.Warn("autoplay queue full, skipping", "room", slug)
	}
}

type room struct {
	slug string
	// Closed when the room is deleted (#618) — the tick goroutine is the
	// only reader, and it returns rather than ticking for a room nobody
	// can reach any more.
	stop    chan struct{}
	mu      sync.Mutex
	clients map[*client]struct{}
	metrics map[string]protocol.RiderMetrics // keyed by rider id, drained each tick
	cheers  []protocol.Cheer                 // this second's reactions, drained each tick
	chat    []protocol.ChatLine              // this second's lines, drained each tick (#146)
	reacts  []protocol.ChatReactionCount     // this second's changed reaction totals (#201)
	chatIDs []protocol.ChatID                // ids the async save assigned (#219)
	events  eventLog                         // what the room did, drained each tick (#321)
	session *session
	record  *accumulator
	music   *jukebox
	// riders ever seen this session, so someone who left before the end still
	// gets their ride; saved guards against persisting one session twice.
	sprint   *sprint
	game     gameMode
	lastGame *protocol.GameState
	seen     map[string]protocol.Rider
	// First-seen order this session — the SPEC medal tie-break.
	seenOrder []string
	saved     bool
	// kind+rider → last accepted time: limits are per RIDER, not per socket —
	// a second tab must not double every allowance (audit #219).
	lastInput map[string]time.Time
	// rider id → last live sample, for the rail's watt dot (#251). Entries go
	// stale harmlessly; the map is bounded by riders ever seen.
	lastMetric map[string]time.Time
	// The phase the timeline last spoke a line about (#359) — a transition
	// says it once, not every tick it stays there.
	phaseSaid string
	// Pings the lobby (#251) when the tick sees phase or the riding set change.
	changed func()
	// Voice (#467): who is in the channel now, folded to rider ids by the
	// hub from LiveKit's state, and how long each of them was in it while
	// the timeline ran — the session voice bonus's input. Bounded by the
	// channel's participants; reset on start.
	voiceNow map[string]struct{}
	voiceMs  map[string]int64
	// Sensor claims (#610): rider id → kind → the screen holding it. Bounded
	// by riders present times the four kinds; see pairing.go for why the hub
	// arbitrates something the browser owns.
	claims map[string]map[string]holder
	// Claim answers waiting for the tick goroutine to write them — the only
	// writer per socket.
	pendingPairing map[*client]protocol.SensorPairing
	// Pokes waiting for the same writer. A slice preserves simultaneous pokes
	// from different riders instead of letting the last one erase the first.
	pendingPokes map[*client][]protocol.Poke
	// Who pressed start — the coach of record for Crew Chief.
	startedBy string
	xp        XpKeeper
}

// ridingWindow is how recent a sample must be to count as "riding now".
const ridingWindow = 10 * time.Second

// A poke is deliberately harder to repeat than chat or a cheer: it asks one
// person's machine for attention and must not become a harassment button.
const pokeCooldown = 10 * time.Second

// ridingLocked names riders with a live sample inside ridingWindow — the
// caller holds rm.mu.
func (rm *room) ridingLocked(now time.Time) []string {
	var names []string
	for id, at := range rm.lastMetric {
		if now.Sub(at) <= ridingWindow {
			if rider, ok := rm.seen[id]; ok {
				names = append(names, rider.Name)
			}
		}
	}
	sort.Strings(names)
	return names
}

func (rm *room) allow(kind, riderID string, now time.Time, min time.Duration) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.lastInput == nil {
		rm.lastInput = make(map[string]time.Time)
	}
	key := kind + ":" + riderID
	if now.Sub(rm.lastInput[key]) < min {
		return false
	}
	rm.lastInput[key] = now
	return true
}

func newRoom(slug string) *room {
	return &room{
		slug:       slug,
		stop:       make(chan struct{}),
		clients:    make(map[*client]struct{}),
		metrics:    make(map[string]protocol.RiderMetrics),
		session:    newSession(),
		record:     newAccumulator(),
		music:      newJukebox(),
		seen:       make(map[string]protocol.Rider),
		lastMetric: make(map[string]time.Time),
		voiceNow:   make(map[string]struct{}),
		voiceMs:    make(map[string]int64),
	}
}

type client struct {
	rider protocol.Rider
	conn  *websocket.Conn
	// Which tab this socket is, and the word its rider's other screens
	// render for it (#610). Both arrive with the first sensor claim and are
	// read under rm.mu like the rest of the socket's room state.
	tab    string
	device string
}

// Cheers and chat reactions are shape-checked (protocol.IsIconOrEmoji — an
// icon key, or one emoji from a client built before #447; never text), not
// allowlisted: which reactions a room speaks is its owner's palette (#223),
// enforced client-side. The wire only guarantees a reaction can't smuggle chat.

// canControl is the SPEC roles matrix row "pick workout / start / pause / end".
func canControl(role string) bool { return role == "owner" || role == "coach" }

// HandleWS upgrades the connection and pumps messages until the client leaves.
// Membership is the price of entry: metrics are room-scoped (privacy is
// architecture), so an unauthorized socket never reaches a room at all.
func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	rider, err := h.access.Authorize(r, slug)
	if err != nil {
		// Before the upgrade: a plain 403 is clearer to debug than a WS close code.
		http.Error(w, "not a member of this room", http.StatusForbidden)
		return
	}

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	rm := h.room(slug)
	c := &client{rider: rider, conn: conn}
	rm.join(c)
	h.PresenceChanged()
	h.log.Info("rider joined", "room", slug, "rider", rider.ID)
	// Autoplay (#627): a rider joining an idle deck may be the room coming
	// back to life. The check is async — never block this rider's upgrade on
	// a database read.
	h.triggerAutoplay(rm, slug)
	defer func() {
		rm.leave(c)
		_ = conn.CloseNow()
		h.PresenceChanged()
		h.log.Info("rider left", "room", slug, "rider", rider.ID)
	}()

	ctx := r.Context()
	for {
		var msg protocol.ClientMessage
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			return
		}
		if msg.Sensors != nil {
			// Claims are per rider and cost one comparison per kind, so they
			// need no rate limit of their own — a client repeating itself
			// changes nothing and queues nothing.
			if rm.claimSensors(c, *msg.Sensors) {
				rm.announcePairing(rider.ID)
			}
		}
		if msg.Poke != nil {
			to := strings.TrimSpace(msg.Poke.To)
			if to == "" || to == rider.ID {
				h.writeError(ctx, c, "validation_error", "Choose another rider to poke.")
				continue
			}
			if !rm.hasRider(to) {
				h.writeError(ctx, c, "invalid_request", "That rider is no longer in the room.")
				continue
			}
			// The target is part of the rate-limit key: one rider cannot evade
			// the cooldown with another tab, but may still poke somebody else.
			if !rm.allow("poke:"+to, rider.ID, h.now(), pokeCooldown) {
				// A cooldown that drops in silence reads as a broken button,
				// and the sender pokes again (errors.md).
				h.writeError(ctx, c, "conflict", "You just poked them — give them a moment to notice.")
				continue
			}
			if !rm.queuePoke(to, protocol.Poke{
				To: to, FromID: rider.ID, From: rider.Name, At: h.now().UnixMilli(),
			}) {
				h.writeError(ctx, c, "invalid_request", "That rider is no longer in the room.")
			}
		}
		if msg.Metrics != nil {
			if m := *msg.Metrics; validMetrics(m) {
				rm.setMetrics(c, m)
			}
		}
		if msg.Chat != nil {
			// Untrusted input: bounded text, 1/s per rider, sender is presence.
			text := strings.TrimSpace(msg.Chat.Text)
			if utf8.RuneCountInString(text) > 500 {
				// The client caps at 500 CHARACTERS — counting bytes here cut
				// non-Latin scripts off at half the advertised limit and then
				// dropped the line silently (audit #219).
				h.writeError(ctx, c, "validation_error", "That message is too long — 500 characters is the cap.")
				continue
			}
			// Untrusted like the text: an image id is a 36-char UUID the room's
			// serve endpoint scopes anyway — anything else is dropped, not the
			// line's problem (#279).
			imageID := msg.Chat.ImageID
			if len(imageID) != 36 {
				imageID = ""
			}
			if (text != "" || imageID != "") && rm.allow("chat", rider.ID, h.now(), time.Second) {
				line := protocol.ChatLine{From: rider.Name, FromID: rider.ID, Text: text, ImageID: imageID, At: h.now().UnixMilli()}
				// The save runs on the hub's worker, never in this read loop
				// (#219): the line broadcasts now, id-less; its persisted id
				// follows on a later tick as a ChatID.
				if h.chat != nil {
					select {
					case h.saves <- chatSave{rm: rm, slug: slug, riderID: rider.ID, text: text, imageID: imageID, at: line.At}:
					default:
						// Full queue: the line stays ephemeral — blocking the
						// sender's reads would be the worse failure.
						h.log.Warn("chat save queue full, line not persisted", "room", slug, "rider", rider.ID)
					}
				}
				rm.chatLine(line)
			}
		}
		if msg.ChatReact != nil && h.chat != nil {
			if protocol.IsIconOrEmoji(msg.ChatReact.Emoji) && rm.allow("react", rider.ID, h.now(), 300*time.Millisecond) {
				if count, added, ok := h.chat.ToggleReaction(ctx, slug, msg.ChatReact.MessageID, rider.ID, msg.ChatReact.Emoji); ok {
					rm.reactionChanged(protocol.ChatReactionCount{
						MessageID: msg.ChatReact.MessageID, Emoji: msg.ChatReact.Emoji,
						Count: count, By: rider.ID, Added: added,
					})
				}
			}
		}
		if msg.Cheer != nil {
			if protocol.IsIconOrEmoji(msg.Cheer.Emoji) && rm.allow("cheer", rider.ID, h.now(), time.Second) {
				rm.cheer(protocol.Cheer{Emoji: msg.Cheer.Emoji, From: rider.Name})
			}
		}
		if msg.Jukebox != nil {
			// Any member; the jukebox validates its own input. Throttled like
			// every other input — it was the one unlimited channel (audit #219).
			if rm.allow("jukebox", rider.ID, h.now(), 300*time.Millisecond) {
				if played, _ := rm.jukebox(*msg.Jukebox, rider.ID, rider.Name, h.now()); played != nil && h.xp != nil {
					h.xp.TrackPlayed(slug, played.riderID, played.ref, h.now())
				}
			}
		}
		if msg.Backfill != nil {
			// A reconnect's replay: into the ride record only — stale samples
			// must never repaint anyone's live tile. Batch size is bounded like
			// every other client input.
			samples := msg.Backfill.Samples
			if len(samples) > maxBackfillBatch {
				samples = samples[:maxBackfillBatch]
			}
			rm.backfill(rider, samples)
			h.log.Info("backfill received", "room", slug, "rider", rider.ID, "samples", len(samples))
		}
		if msg.Control != nil {
			// The role on THIS socket, not the copy captured when it opened:
			// a promotion mid-session has to land without a reconnect.
			if !canControl(rm.roleOf(c)) {
				h.writeError(ctx, c, "forbidden", "Only the owner or a coach controls the session.")
				continue
			}
			if msg.Control.Action == "game" {
				if !rm.startGame(msg.Control.GameMode, h.now()) {
					h.writeError(ctx, c, "invalid_request", "That game mode does not exist, or one is already running.")
				}
				continue
			}
			if msg.Control.Action == "game-end" {
				rm.endGame()
				continue
			}
			if msg.Control.Action == "sprint" {
				// Arm sprint moments: owner/coach (matrix), only mid-session.
				if rm.armIfRunning(h.now()) {
					continue
				}
				h.writeError(ctx, c, "invalid_request", "Sprints arm during a running session.")
				continue
			}
			if !rm.control(*msg.Control, rider.ID, h.now()) {
				h.writeError(ctx, c, "invalid_request", "That does not work right now — the session is in another phase.")
			}
		}
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

// roleOf reads a client's current role under the room lock — SetRole can
// change it while that client's read loop is blocked on the next message.
func (rm *room) roleOf(c *client) string {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return c.rider.Role
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

// PostChat hands a line that arrived over HTTP (#468) to whoever is
// connected: it rides the next tick exactly like a socket line. The hub
// lock finds the room, the room lock queues it — never both at once. A room
// nobody holds open gets nothing: its riders will read the backlog when
// they arrive, and a line parked in an empty room's queue would land twice.
func (h *Hub) PostChat(slug string, line protocol.ChatLine) {
	if rm := h.occupied(slug); rm != nil {
		rm.chatLine(line)
	}
	// Everyone's unread count for this room just changed (#568). A room
	// nobody holds open never ticks, so this is the only ping it will get;
	// when the room IS live the tick pings too and the lobby coalesces the
	// pair — one ping is enough either way.
	h.PresenceChanged()
}

// PostReaction is PostChat for a reaction toggled over HTTP (#468).
func (h *Hub) PostReaction(slug string, change protocol.ChatReactionCount) {
	if rm := h.occupied(slug); rm != nil {
		rm.reactionChanged(change)
	}
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

// occupied is the room at slug if anyone is connected to it — never creating
// one, unlike room(): an HTTP post must not start a ticker for nobody.
func (h *Hub) occupied(slug string) *room {
	h.mu.Lock()
	rm, ok := h.rooms[slug]
	h.mu.Unlock()
	if !ok {
		return nil
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if len(rm.clients) == 0 {
		return nil
	}
	return rm
}

func (h *Hub) Presence(slug string) protocol.RoomPresence {
	h.mu.Lock()
	rm, ok := h.rooms[slug]
	p := protocol.RoomPresence{Phase: "idle", Voice: make([]string, 0, 4)}
	// Fold by rider, not by connection: two tabs are one person on the radar,
	// and a camera live in either of them is that person on camera (#293).
	names := make(map[string]string, len(h.voice[slug]))
	cameras := make(map[string]bool, len(h.voice[slug]))
	for _, entry := range h.voice[slug] {
		names[entry.rider] = entry.name
		cameras[entry.rider] = cameras[entry.rider] || entry.camera
	}
	for rider, name := range names {
		p.Voice = append(p.Voice, name)
		if cameras[rider] {
			p.Cameras = append(p.Cameras, name)
		}
	}
	h.mu.Unlock()
	sort.Strings(p.Voice)
	sort.Strings(p.Cameras)
	if !ok {
		return p
	}
	now := h.now()
	rm.mu.Lock()
	defer rm.mu.Unlock()
	seen := make(map[string]struct{}, len(rm.clients))
	for c := range rm.clients {
		if _, dup := seen[c.rider.ID]; dup {
			continue
		}
		seen[c.rider.ID] = struct{}{}
		p.Riders = append(p.Riders, c.rider.Name)
	}
	sort.Strings(p.Riders)
	p.Connected = len(seen)
	p.Riding = rm.ridingLocked(now)
	state := rm.session.state(now)
	p.Phase = state.Phase
	if state.Phase == "countdown" || state.Phase == "running" || state.Phase == "paused" {
		// The late-join radar: enough to render "Openers · 32 min in".
		p.WorkoutName = state.WorkoutName
		p.ElapsedSec = state.Elapsed
	}
	return p
}

// OnlineCount is WhereIs without the who: how many distinct riders hold a
// lobby socket right now. The landing page's one live number — a count only,
// no identities, so it stays safe to serve to a signed-out visitor.
func (h *Hub) OnlineCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	seen := make(map[string]struct{}, len(h.lobby))
	for _, id := range h.lobby {
		seen[id] = struct{}{}
	}
	return len(seen)
}

// WhereIs answers the friends panel (ADR-0012): who is online, and which room
// each of these users is connected to right now — live state only, persisted
// nowhere. Present in the map = online (the lobby socket, #251 — Slack's green
// dot); a non-empty value names the room. Lock, copy the room refs, unlock;
// then per-room lock to scan clients.
func (h *Hub) WhereIs(userIDs []string) map[string]string {
	wanted := make(map[string]struct{}, len(userIDs))
	for _, id := range userIDs {
		wanted[id] = struct{}{}
	}
	out := make(map[string]string, len(userIDs))
	h.mu.Lock()
	rooms := make(map[string]*room, len(h.rooms))
	for slug, rm := range h.rooms {
		rooms[slug] = rm
	}
	for _, id := range h.lobby {
		if _, ok := wanted[id]; ok {
			out[id] = ""
		}
	}
	h.mu.Unlock()

	for slug, rm := range rooms {
		rm.mu.Lock()
		for c := range rm.clients {
			if _, ok := wanted[c.rider.ID]; ok {
				out[c.rider.ID] = slug
			}
		}
		rm.mu.Unlock()
	}
	return out
}

// VoiceJoined/VoiceLeft feed the sidebar radar (#149) from LiveKit's
// webhooks — who is in the voice channel, before you enter the room. Keyed
// by identity so a double event cannot duplicate a name; the map is
// hub-owned like every other piece of live state.
func (h *Hub) VoiceJoined(slug, identity, name string) {
	h.mu.Lock()
	if h.voice[slug] == nil {
		h.voice[slug] = make(map[string]voiceEntry, 4)
	}
	// Merge, don't overwrite: a camera flag set by an early track_published
	// must survive the participant_joined that follows it.
	entry := h.voice[slug][identity]
	entry.rider = av.RiderID(identity)
	entry.name = name
	if entry.joinedAt.IsZero() {
		entry.joinedAt = h.now()
	}
	h.voice[slug][identity] = entry
	after := h.voiceChangedLocked(slug)
	h.mu.Unlock()
	after()
}

func (h *Hub) VoiceLeft(slug, identity string) {
	h.mu.Lock()
	delete(h.voice[slug], identity)
	if len(h.voice[slug]) == 0 {
		delete(h.voice, slug)
	}
	after := h.voiceChangedLocked(slug)
	h.mu.Unlock()
	after()
}

// voiceRidersLocked folds a room's voice entries to rider ids — two tabs are
// one rider. The caller holds h.mu.
func (h *Hub) voiceRidersLocked(slug string) map[string]struct{} {
	riders := make(map[string]struct{}, len(h.voice[slug]))
	for _, entry := range h.voice[slug] {
		riders[entry.rider] = struct{}{}
	}
	return riders
}

// voiceChangedLocked pings the lobby and hands back what to do once h.mu is
// released: tell the live room who is in voice now (#467). The room lock is
// never taken under the hub lock — same discipline as Presence.
func (h *Hub) voiceChangedLocked(slug string) func() {
	h.pingLobbyLocked()
	rm, live := h.rooms[slug]
	if !live {
		return func() {}
	}
	riders := h.voiceRidersLocked(slug)
	return func() { rm.setVoice(riders) }
}

// VoiceRiderIDs is every rider in any voice channel right now, once each —
// the lounge-XP ticker's input (#467). Lock, copy, unlock.
func (h *Hub) VoiceRiderIDs() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	seen := make(map[string]struct{})
	for _, entries := range h.voice {
		for _, entry := range entries {
			seen[entry.rider] = struct{}{}
		}
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// VoiceCamera flips one participant's camera flag (#251) — track_published /
// track_unpublished. Upserts: the track event can beat the join webhook, and
// a live camera implies presence in the voice room anyway.
func (h *Hub) VoiceCamera(slug, identity, name string, on bool) {
	h.mu.Lock()
	entry, ok := h.voice[slug][identity]
	if !ok && !on {
		h.mu.Unlock()
		return
	}
	if !ok {
		entry = voiceEntry{rider: av.RiderID(identity), name: name, joinedAt: h.now()}
	}
	entry.camera = on
	if h.voice[slug] == nil {
		h.voice[slug] = make(map[string]voiceEntry, 4)
	}
	h.voice[slug][identity] = entry
	after := h.voiceChangedLocked(slug)
	h.mu.Unlock()
	after()
}

// VoiceRoomClosed clears a whole room's voice state (room_finished).
func (h *Hub) VoiceRoomClosed(slug string) {
	h.mu.Lock()
	delete(h.voice, slug)
	after := h.voiceChangedLocked(slug)
	h.mu.Unlock()
	after()
}

// VoiceRooms lists the rooms the radar currently shows anyone in — the
// reconciler's work list. Lock, copy, unlock.
func (h *Hub) VoiceRooms() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	slugs := make([]string, 0, len(h.voice))
	for slug := range h.voice {
		slugs = append(slugs, slug)
	}
	return slugs
}

// VoiceSync applies LiveKit's actual participant list (#234): a hard-crashed
// LiveKit never sends participant_left, so identities it no longer knows are
// pruned — unless they joined after the snapshot at `since` was requested —
// and anyone a lost webhook missed is added.
func (h *Hub) VoiceSync(slug string, present map[string]string, since time.Time) {
	h.mu.Lock()
	after := func() {}
	defer func() { h.mu.Unlock(); after() }()
	changed := false
	for identity, entry := range h.voice[slug] {
		if _, ok := present[identity]; !ok && entry.joinedAt.Before(since) {
			delete(h.voice[slug], identity)
			changed = true
		}
	}
	for identity, name := range present {
		if _, ok := h.voice[slug][identity]; ok {
			continue
		}
		if h.voice[slug] == nil {
			h.voice[slug] = make(map[string]voiceEntry, len(present))
		}
		h.voice[slug][identity] = voiceEntry{rider: av.RiderID(identity), name: name, joinedAt: h.now()}
		changed = true
	}
	if len(h.voice[slug]) == 0 {
		delete(h.voice, slug)
	}
	if changed {
		after = h.voiceChangedLocked(slug)
	}
}

func (h *Hub) writeError(ctx context.Context, c *client, code, message string) {
	writeCtx, cancel := context.WithTimeout(ctx, tickInterval)
	defer cancel()
	_ = wsjson.Write(writeCtx, c.conn, protocol.ServerMessage{
		Error: &protocol.Error{Code: code, Message: message},
	})
}

func (h *Hub) room(slug string) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	rm, ok := h.rooms[slug]
	if !ok {
		rm = newRoom(slug)
		rm.changed = h.PresenceChanged
		rm.xp = h.xp
		// Voice can be live before the first socket opens the room — seed
		// it, unlocked: nobody else can hold this room yet.
		rm.voiceNow = h.voiceRidersLocked(slug)
		h.rooms[slug] = rm
		go rm.run(h.now, h.saver)
	}
	return rm
}

// run broadcasts one tick per interval while anyone is connected. The tick
// always carries the session state and roster — the timer must advance on
// screens even when nobody is pedalling yet.
// ponytail: the ticker runs while the room is empty; rooms are cheap and few,
// stop-on-empty can land with room GC if it ever shows up in a profile.
func (rm *room) run(now func() time.Time, saver SessionSaver) {
	// A timer, not a ticker: the interval bursts to 4 Hz while a sprint window
	// is live (SPEC) and returns to 1 Hz after.
	timer := time.NewTimer(tickInterval)
	defer timer.Stop()
	// Presence push (#251): phase and the riding set are the live signals the
	// rail shows for rooms you are NOT in — ping the lobby only when one of
	// them changes between ticks, never per tick.
	lastPhase, lastRiding := "", ""
	lastTick := now()
	for {
		select {
		case <-rm.stop:
			// The room was deleted: no tick, and no session save — the
			// durable row it would reference is already gone.
			return
		case <-timer.C:
		}
		rm.mu.Lock()
		// Wall time since the previous tick — the voice clock's step, which a
		// sprint's 4 Hz burst must not quadruple.
		dt := now().Sub(lastTick)
		lastTick = now()
		interval := tickInterval
		if sp := rm.sprint; sp != nil {
			t := now()
			if t.After(sp.startsAt.Add(-time.Second)) && t.Before(sp.endsAt.Add(time.Second)) {
				interval = burstTick
			}
		}
		timer.Reset(interval)
		if len(rm.clients) == 0 {
			rm.mu.Unlock()
			continue
		}
		if rm.game != nil {
			samples := make(map[string]int, len(rm.metrics))
			for id, m := range rm.metrics {
				samples[id] = m.Watts
			}
			rm.game.advance(now(), samples, rm.seen)
			gs := rm.game.state(now())
			rm.lastGame = &gs
		} else {
			rm.lastGame = nil
		}
		// Drain a bounded slice per tick and CARRY the overflow — a burst
		// above the per-tick cap used to vanish silently (#219).
		chatNow := rm.chat
		if len(chatNow) > 32 {
			chatNow = rm.chat[:32]
			rm.chat = append([]protocol.ChatLine(nil), rm.chat[32:]...)
		} else {
			rm.chat = nil
		}
		reactsNow := rm.reacts
		if len(reactsNow) > 64 {
			reactsNow = rm.reacts[:64]
			rm.reacts = append([]protocol.ChatReactionCount(nil), rm.reacts[64:]...)
		} else {
			rm.reacts = nil
		}
		idsNow := rm.chatIDs
		rm.chatIDs = nil
		// Resolved before the drain so a transition's own line rides the tick
		// that carries the transition, not the one after it.
		state := rm.session.state(now())
		rm.sayPhaseLocked(state, now())
		rm.accrueVoiceLocked(state.Phase, dt)
		sprintNow, sprintWinner := rm.scoreSprintLocked(now())
		eventsNow := rm.events.drain()
		tick := protocol.ServerTick{
			At:            now().UnixMilli(),
			State:         state,
			Jukebox:       rm.music.snapshot(),
			Cheers:        rm.cheers,
			Chat:          chatNow,
			ChatReactions: reactsNow,
			ChatIDs:       idsNow,
			Events:        eventsNow,
			Sprint:        sprintNow,
			Game:          rm.lastGame,
			Execution: func() map[string]float64 {
				out := make(map[string]float64, len(rm.seen))
				for id := range rm.seen {
					out[id] = rm.record.execution(id)
				}
				return out
			}(),
			Voice:  rm.voiceIDsLocked(),
			Riders: rm.metrics,
			Roster: make([]protocol.Rider, 0, len(rm.clients)),
		}
		rm.metrics = make(map[string]protocol.RiderMetrics)
		rm.cheers = nil
		// The session just closed: hand the ride record to the saver exactly
		// once. Snapshot under the lock, persist outside it (hub discipline:
		// no I/O while holding a room mutex).
		var closing []RiderRecord
		var closingMeta protocol.SessionState
		var closed *SessionClosed
		if tick.State.Phase == "done" && !rm.saved {
			rm.saved = true
			closingMeta = tick.State
			if saver != nil {
				for _, id := range rm.seenOrder {
					if record, ok := rm.record.byRider[id]; ok {
						closing = append(closing, RiderRecord{Rider: rm.seen[id], Samples: record.samples})
					}
				}
			}
			if rm.xp != nil {
				closed = rm.closedLocked(tick.State, now())
			}
		}
		clients := make([]*client, 0, len(rm.clients))
		// One roster entry per rider, however many sockets they hold — the same
		// person on a dashboard and a phone is one presence, and duplicate ids
		// are poison to keyed rendering downstream.
		seen := make(map[string]struct{}, len(rm.clients))
		for c := range rm.clients {
			clients = append(clients, c)
			if _, dup := seen[c.rider.ID]; !dup {
				seen[c.rider.ID] = struct{}{}
				tick.Roster = append(tick.Roster, c.rider)
			}
		}
		ridingKey := strings.Join(rm.ridingLocked(now()), "\n")
		spoke := len(tick.Chat) > 0
		// Claim answers ride out with this tick but not IN it (#610): a
		// rider's device inventory is theirs, and the tick goes to the room.
		pairing := rm.drainPairingLocked()
		pokes := rm.drainPokesLocked()
		rm.mu.Unlock()
		// Someone spoke: every sidebar's unread count for this room just went
		// stale, and a rider who is NOT standing in the room announces the
		// line off that count (#568). Without this it waited for the lobby's
		// 60 s fallback poll.
		if rm.changed != nil && (tick.State.Phase != lastPhase || ridingKey != lastRiding || spoke) {
			lastPhase, lastRiding = tick.State.Phase, ridingKey
			rm.changed()
		}
		// Stable roster order, so tiles do not shuffle every second.
		sort.Slice(tick.Roster, func(i, j int) bool { return tick.Roster[i].ID < tick.Roster[j].ID })

		if closing != nil {
			// Fire and hand off: the tick loop never blocks on the database.
			// The saver owns timeouts and retries (#235); the goroutine exits
			// when its bounded retry policy returns — minutes at worst.
			go saver.SaveSession(context.Background(), rm.slug,
				closingMeta.WorkoutName, closingMeta.WorkoutJSON,
				time.UnixMilli(now().UnixMilli()-int64(closingMeta.Elapsed)*1000), closing)
		}
		// The keeper returns at once (it queues its own I/O) — still outside
		// the lock, like every other hand-off.
		if closed != nil {
			rm.xp.SessionClosed(*closed)
		}
		if sprintWinner != "" && rm.xp != nil {
			rm.xp.SprintWon(rm.slug, sprintWinner, now())
		}

		metricTicks.Inc()
		message := protocol.ServerMessage{Tick: &tick}
		for _, c := range clients {
			ctx, cancel := context.WithTimeout(context.Background(), tickInterval)
			// ponytail: slow consumers just miss ticks; per-client send queues when it matters
			_ = wsjson.Write(ctx, c.conn, message)
			// Addressed to this socket alone, so it cannot be folded into the
			// tick — and written here because this goroutine is the socket's
			// only writer.
			if answer, ok := pairing[c]; ok {
				_ = wsjson.Write(ctx, c.conn, protocol.ServerMessage{Pairing: &answer})
			}
			for _, pending := range pokes[c] {
				poke := pending
				_ = wsjson.Write(ctx, c.conn, protocol.ServerMessage{Poke: &poke})
			}
			cancel()
		}
	}
}

// sayPhaseLocked puts a line on the timeline when the session crosses into a
// phase worth talking about (#359), once per crossing. The transition is the
// trigger, never the control message: the clock closes a session as readily
// as a coach does, and a rider staring at the stage hears about both.
func (rm *room) sayPhaseLocked(state protocol.SessionState, now time.Time) {
	if state.Phase == rm.phaseSaid {
		return
	}
	rm.phaseSaid = state.Phase
	switch state.Phase {
	case "countdown":
		rm.events.add(sessionLine("started", "", state.WorkoutName, time.Time{}, now), now)
	case "done":
		rm.events.add(sessionLine("ended", "", state.WorkoutName, time.Time{}, now), now)
	}
}

func (rm *room) join(c *client) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.clients[c] = struct{}{}
	metricRiders.Inc()
}

func (rm *room) leave(c *client) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	delete(rm.clients, c)
	delete(rm.pendingPairing, c)
	delete(rm.pendingPokes, c)
	// Closing a tab frees its sensors, so the rider's other screens can pair
	// (#610). Queued after the delete above, so the leaver is not told.
	if rm.releaseSensorsLocked(c) {
		rm.queuePairingLocked(c.rider.ID)
	}
	// A phone spectator closing must not blank the desktop's tile: metrics
	// go only when the rider's LAST socket does (#219).
	last := true
	for other := range rm.clients {
		if other.rider.ID == c.rider.ID {
			last = false
			break
		}
	}
	if last {
		delete(rm.metrics, c.rider.ID)
	}
	metricRiders.Dec()
}

// validMetrics bounds WS input before it touches room state.
func validMetrics(m protocol.RiderMetrics) bool {
	return m.Watts >= 0 && m.Watts <= 3000 &&
		m.HR >= 0 && m.HR <= 250 &&
		m.Cadence >= 0 && m.Cadence <= 250
}

func (rm *room) setMetrics(c *client, m protocol.RiderMetrics) {
	rider := c.rider
	rm.mu.Lock()
	defer rm.mu.Unlock()
	// One stream per rider (#610). Two paired screens do not merely overwrite
	// each other here — their per-session `seq` counters interleave, which
	// reads to the accumulator as a fresh stream and lands BOTH sets of
	// samples in the one ride record. So the screen holding the trainer claim
	// is the only one that speaks; a rider with no claim at all is unaffected.
	if !rm.ownsTrainerLocked(c) {
		return
	}
	rm.metrics[rider.ID] = m
	rm.lastMetric[rider.ID] = time.Now()
	if _, known := rm.seen[rider.ID]; !known {
		rm.seenOrder = append(rm.seenOrder, rider.ID)
	}
	rm.seen[rider.ID] = rider
	// The live sample is also part of the ride record; a later resend of the
	// same seq dedupes against it, and it scores live at the timeline second
	// it arrived on (#27).
	if rm.session.phase == "running" {
		state := rm.session.state(time.Now())
		rm.record.add(rider.ID, m, rm.session.segments, float64(rider.FtpWatts), state.Elapsed)
		rm.sprint.collect(rider.ID, m.Watts, time.Now())
	}
}

// backfill lands in the record whatever the phase: after a server restart the
// room comes back idle, and dropping the replay then is exactly the data loss
// this exists to prevent. The record is bounded per rider and reset on the
// next start, so out-of-session samples cost nothing and hurt nobody.
func (rm *room) backfill(rider protocol.Rider, samples []protocol.RiderMetrics) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if _, known := rm.seen[rider.ID]; !known {
		rm.seenOrder = append(rm.seenOrder, rider.ID)
	}
	rm.seen[rider.ID] = rider
	for _, m := range samples {
		if validMetrics(m) {
			// Backfilled samples have no known timeline second — recorded, not
			// live-scored; the save-time score is the authoritative one. They
			// are also the one place a seq goes backwards on purpose, so they
			// stay on the stream that sent them (#522).
			rm.record.replay(rider.ID, m)
		}
	}
}

// cheer queues one reaction for the next tick; bounded so a hostile burst
// cannot grow the payload (the per-client rate limit already makes this rare).
func (rm *room) cheer(c protocol.Cheer) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if len(rm.cheers) < 32 {
		rm.cheers = append(rm.cheers, c)
	}
}

func (rm *room) chatLine(line protocol.ChatLine) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	// 256 bounds a hostile flood; the tick drains 32 per second and CARRIES
	// the rest — a burst must not silently eat accepted lines (#219).
	if len(rm.chat) < 256 {
		rm.chat = append(rm.chat, line)
	}
}

func (rm *room) chatIDAssigned(id protocol.ChatID) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	// Bounded like every tick queue; the save queue's own 256 cap means this
	// can only fill if ticks stall, and then persistence is the least worry.
	if len(rm.chatIDs) < 256 {
		rm.chatIDs = append(rm.chatIDs, id)
	}
}

func (rm *room) reactionChanged(count protocol.ChatReactionCount) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if len(rm.reacts) < 256 {
		rm.reacts = append(rm.reacts, count)
	}
}

// jukebox runs one deck command and hands back the track it finished, if
// this command was the one that ended it (#467) — for the caller to credit
// outside the lock.
func (rm *room) jukebox(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) (*playedTrack, bool) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	events, ok := rm.music.apply(cmd, riderID, addedBy, now)
	for _, ev := range events {
		rm.events.add(ev, now)
	}
	played := rm.music.finished
	rm.music.finished = nil
	return played, ok
}

// autoplayActor is the AddedBy/riderID this feature's own additions carry —
// nobody queued them, the room did, so they earn no DJ credit (#467) and the
// deck's "queued by" line says what actually happened.
const autoplayActor = "Autoplay"

// applyAutoplay seeds the queue from what triggerAutoplay's DB read found
// (#627). Re-checks idle under the lock: the read ran outside it, so a
// manual add — or another join's own trigger racing this one — may have
// already filled the deck by the time this runs, and the last one to the
// lock backs off rather than doubling the queue.
func (rm *room) applyAutoplay(fixed *protocol.JukeboxCommand, tracks []protocol.JukeboxCommand, ok bool, now time.Time) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if !ok || rm.music.state.Current != nil {
		return
	}
	cmds := tracks
	if fixed != nil {
		cmds = append([]protocol.JukeboxCommand{*fixed}, tracks...)
	}
	for _, cmd := range cmds {
		events, added := rm.music.apply(cmd, "", autoplayActor, now)
		if !added {
			break
		}
		for _, ev := range events {
			rm.events.add(ev, now)
		}
	}
}

// startGame begins a mode; refused while another runs (end it first).
func (rm *room) startGame(mode string, now time.Time) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.game != nil && !rm.game.done() {
		return false
	}
	next := newGameMode(mode, now)
	if next == nil {
		return false
	}
	rm.game = next
	return true
}

func (rm *room) endGame() {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.game = nil
}

func (rm *room) armIfRunning(now time.Time) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.session.phase != "running" {
		return false
	}
	rm.armSprint(now)
	return true
}

func (rm *room) control(c protocol.Control, riderID string, now time.Time) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	// A new start is a new ride: the record must not blend two sessions.
	if c.Action == "start" {
		rm.record.reset()
		rm.seen = make(map[string]protocol.Rider)
		rm.seenOrder = nil
		rm.saved = false
		rm.voiceMs = make(map[string]int64)
		rm.startedBy = riderID
	}
	return rm.session.apply(c, now)
}

// setVoice replaces who the hub says is in the channel (#467).
func (rm *room) setVoice(riders map[string]struct{}) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.voiceNow = riders
}

// voiceIDsLocked is who the hub says is in the channel, in the shape the tick
// carries it. Sorted so a tick does not churn on map order. Caller holds rm.mu.
func (rm *room) voiceIDsLocked() []string {
	if len(rm.voiceNow) == 0 {
		return nil
	}
	ids := make([]string, 0, len(rm.voiceNow))
	for id := range rm.voiceNow {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// accrueVoiceLocked adds one tick's worth of voice time to everyone in the
// channel while the timeline runs (#467). Caller holds rm.mu.
func (rm *room) accrueVoiceLocked(phase string, dt time.Duration) {
	if phase != "running" {
		return
	}
	for id := range rm.voiceNow {
		rm.voiceMs[id] += dt.Milliseconds()
	}
}

// scoreSprintLocked renders the sprint for the tick and names the winner on
// the one tick that scores it (#467). Caller holds rm.mu.
func (rm *room) scoreSprintLocked(now time.Time) (*protocol.SprintState, string) {
	scoredBefore := rm.sprint != nil && rm.sprint.scored
	state := rm.sprint.state(now, rm.seen)
	if scoredBefore || rm.sprint == nil || !rm.sprint.scored || len(rm.sprint.results) < minSprintField {
		return state, ""
	}
	return state, rm.sprint.results[0].RiderID
}

// closedLocked is the session as the XpKeeper hears it (#467): everyone who
// rode, everyone who was in voice, and who pressed start. Caller holds rm.mu.
func (rm *room) closedLocked(state protocol.SessionState, now time.Time) *SessionClosed {
	ev := &SessionClosed{Slug: rm.slug, StartedBy: rm.startedBy, Seconds: state.Elapsed, At: now}
	for _, id := range rm.seenOrder {
		ev.Riders = append(ev.Riders, SessionRider{
			ID: id, Rode: rm.record.count(id) >= MinRideSamples,
			VoiceSeconds: int(rm.voiceMs[id] / 1000),
		})
	}
	// Voice-only people — a coach without a trainer, a spectator on the
	// call — in a stable order, since the map has none.
	var listeners []string
	for id := range rm.voiceMs {
		if _, rode := rm.seen[id]; !rode {
			listeners = append(listeners, id)
		}
	}
	sort.Strings(listeners)
	for _, id := range listeners {
		ev.Riders = append(ev.Riders, SessionRider{ID: id, VoiceSeconds: int(rm.voiceMs[id] / 1000)})
	}
	return ev
}
