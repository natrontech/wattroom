// The room socket: one client per connection, its outbound queue, and the
// handler that authorises a rider, joins them to the room and reads their
// frames. Nothing here holds room state — it hands frames to the room and
// writes what the room hands back.
package hub

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// How many frames a socket may fall behind before it starts missing them.
// Deep enough that a scheduling hiccup costs nothing; shallow enough that a
// client which has stopped reading cannot bank a minute of stale ticks and
// then be shown them (#670).
const clientQueue = 8

// How long one frame may take to leave. Per client now, so it is a bound on
// that socket's writer goroutine rather than on the room's tick.
const writeTimeout = 5 * time.Second

// maxFrame bounds one inbound message. coder/websocket's default is 32 KiB,
// under which a pick carrying a workout near checkPick's own 64 KiB ceiling,
// or a backfill past ~700 samples, did not get refused — the read failed and
// the socket died with it, replay and all (audit 2026-09-09).
const maxFrame = 512 << 10

type client struct {
	rider protocol.Rider
	conn  *websocket.Conn
	// The session this socket rode in on (#2807), what ending that session
	// severs it by. Set at connect and never written again.
	session []byte
	// Outbound frames, already marshalled, written by this socket's own
	// goroutine (#670). The tick loop used to write to every socket in turn
	// with a one-second deadline each, so one client that stopped reading
	// cost the whole room up to a second per tick — and during a sprint, when
	// the room ticks at 4 Hz and the timing actually matters, it collapsed
	// everyone else to 1 Hz. Any member could do it; it was the cheapest
	// in-room denial of service there is.
	out chan []byte
	// Which tab this socket is, and the word its rider's other screens
	// render for it (#610). Both arrive with the first sensor claim and are
	// read under rm.mu like the rest of the socket's room state.
	tab    string
	device string
	// What this socket says it is running on (#2131). Distinct from `device`
	// above, which is sensor arbitration between the rider's own screens and
	// never leaves them: this one is room-visible and arrives whether or not
	// anything was ever paired. Read under rm.mu like the pair above it.
	deviceKind string
	// The workout hash this socket last received the definition for (#1710).
	// Owned by the tick loop: read and written there alone.
	workoutSent string
	// The deck revision this socket last received the deck for (#2838). Same
	// owner, same rule.
	jukeboxSent int64
	// This socket's last measured round trip, in MICROSECONDS, zero until the
	// first ping has been answered (#2131). Written by this socket's writer
	// goroutine and read by the room's tick loop — two goroutines, neither
	// holding the other's lock, so it is atomic rather than guarded by rm.mu.
	//
	// Microseconds because zero has to keep meaning "not measured yet": on a
	// LAN the round trip rounds to nothing in milliseconds, and a real reading
	// must not be indistinguishable from no reading at all.
	rttMicros atomic.Int64
}

// ping is this socket's round trip as the roster reports it: milliseconds,
// and zero when nothing has been measured yet. A round trip under half a
// millisecond reads as 1 rather than as 0 — a real measurement is never
// reported as the absence of one.
func (c *client) ping() int {
	micros := c.rttMicros.Load()
	if micros <= 0 {
		return 0
	}
	if ms := int((micros + 500) / 1000); ms > 0 {
		return ms
	}
	return 1
}

// Cheers and chat reactions are shape-checked (protocol.IsReaction — an icon
// key, one emoji, or a crew's own emoji by `:name:` (#2643); never text), not
// allowlisted: which reactions a crew speaks is its palette (#223), enforced
// client-side. The wire only guarantees a reaction can't smuggle chat.

// HandleWS upgrades the connection and pumps messages until the client leaves.
// Membership is the price of entry: metrics are room-scoped (privacy is
// architecture), so an unauthorized socket never reaches a room at all.
func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	rider, channel, err := h.access.Authorize(r, r.PathValue("id"))
	if err != nil {
		if !errors.Is(err, av.ErrNoSession) && !errors.Is(err, av.ErrNotMember) {
			// The database did not answer (#1984): logged, and a 503 the
			// client retries — not a refusal it would believe.
			h.log.Error("room door", "channel", r.PathValue("id"), "err", err)
			http.Error(w, "the room could not be checked", http.StatusServiceUnavailable)
			return
		}
		// Before the upgrade: a plain 403 is clearer to debug than a WS close code.
		http.Error(w, "not a member of this room", http.StatusForbidden)
		return
	}

	if !h.admitSocket(rider.ID) {
		// Before the upgrade, like the 403: a shared resource is full.
		http.Error(w, "too many open connections for this rider", http.StatusServiceUnavailable)
		return
	}
	defer h.releaseSocket(rider.ID)
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(maxFrame)
	// Held from before the join until after the leave (#2297): the idle sweep
	// must not forget a room in the window where this rider has its pointer
	// and has not joined with it yet. Registered before the writer's defer, so
	// it runs after rm.leave below.
	rm := h.holdRoom(channel)
	defer h.releaseRoom(channel)
	c := &client{rider: rider, conn: conn, session: h.sessionOf(r), out: make(chan []byte, clientQueue)}
	// This socket's own writer, so the room's tick never waits on it (#670).
	writerDone := make(chan struct{})
	defer close(writerDone)
	safego.Go(h.log, "room writer "+channel, func() { c.writeLoop(writerDone, h.keepalive) })
	// This socket's own address, to this socket alone (#2131). Addressed like
	// a pairing answer and for a stronger reason: it is NOT on protocol.Rider
	// and must never be, because the roster is broadcast to the whole room on
	// every tick. A rider may see everyone's ping and nobody's address but
	// their own, and keeping the two facts in different messages is what makes
	// that a property of the shape rather than of a filter somebody has to
	// remember. Nothing stores it — it is read off the request and sent.
	c.sendJSON(h.log, protocol.ServerMessage{
		Connection: &protocol.OwnConnection{IP: httpx.ClientAddr(r)},
	})
	rm.join(c)
	h.PresenceChanged()
	h.log.Info("rider joined", "channel", channel, "rider", rider.ID)
	// Autoplay (#627): a rider joining an idle deck may be the room coming
	// back to life. The check is async — never block this rider's upgrade on
	// a database read.
	h.triggerAutoplay(rm, channel)
	defer func() {
		rm.leave(c)
		_ = conn.CloseNow()
		h.PresenceChanged()
		h.log.Info("rider left", "channel", channel, "rider", rider.ID)
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
				h.writeError(c, "validation_error", "Choose another rider to poke.")
				continue
			}
			if !rm.hasRider(to) {
				h.writeError(c, "invalid_request", "That rider is no longer in the room.")
				continue
			}
			// The target is part of the rate-limit key: one rider cannot evade
			// the cooldown with another tab, but may still poke somebody else.
			if !rm.allow("poke:"+to, rider.ID, h.now(), pokeCooldown) {
				// A cooldown that drops in silence reads as a broken button,
				// and the sender pokes again (errors.md).
				h.writeError(c, "rate_limited", "You just poked them — give them a moment to notice.")
				continue
			}
			poke := protocol.Poke{
				To: to, FromID: rider.ID, From: rider.Name, At: h.now().UnixMilli(),
			}
			if !rm.queuePoke(to, poke) {
				h.writeError(c, "invalid_request", "That rider is no longer in the room.")
				continue
			}
			// The sender's answer (#2721): this socket's own copy, which the
			// client reads as "it landed" because it is from them. Silence on
			// success read as a button that did nothing.
			c.sendJSON(h.log, protocol.ServerMessage{Poke: &poke})
		}
		if msg.Device != nil {
			// Untrusted input, bounded at the boundary to the closed set
			// (errors.md): the room renders this, and anything outside the
			// three words is dropped rather than shown to everyone. Costs one
			// comparison and changes nothing when repeated, so no rate limit
			// of its own — the same reasoning as the sensor claim above.
			rm.setDeviceKind(c, msg.Device.Kind)
		}
		if msg.Away != nil {
			// Unlimited like a sensor claim, and for the same reason: it is
			// one map write per rider, so a client repeating itself changes
			// nothing and queues nothing. The state rides the next tick.
			rm.setAway(rider.ID, msg.Away.Away, msg.Away.Reason)
		}
		if msg.Metrics != nil {
			// Rate-shaped like every other channel (audit 2026-09-09): a trainer
			// notifies at 4 Hz at most, so 10/s is headroom, and the record
			// admits one sample per second anyway.
			if m := *msg.Metrics; validMetrics(m) && rm.allow("metrics", rider.ID, h.now(), metricsMinGap) {
				rm.setMetrics(c, m)
			}
		}
		if msg.Board != nil {
			switch {
			case msg.Board.ClipID == "":
				// A stop (#1321) takes no cooldown: it only ever makes the room
				// quieter, and the fire it takes back is half a second old.
				// fire() is what bounds a rider's stops.
				rm.fire(protocol.Board{FromID: rider.ID, From: rider.Name})
			case protocol.IsClipID(msg.Board.ClipID) && rm.allow("board", rider.ID, h.now(), time.Second):
				// One fire a second per rider (docs/SPEC.md), the same ceiling a
				// cheer takes — and on the server, because a client asking nicely
				// is not a limit.
				rm.fire(protocol.Board{ClipID: msg.Board.ClipID, FromID: rider.ID, From: rider.Name})
			}
		}
		if msg.Cheer != nil {
			if protocol.IsReaction(msg.Cheer.Emoji) && rm.allow("cheer", rider.ID, h.now(), time.Second) {
				rm.cheer(protocol.Cheer{Emoji: msg.Cheer.Emoji, From: rider.Name})
			}
		}
		if msg.Jukebox != nil {
			// Any member; the jukebox validates its own input. Throttled like
			// every other input — it was the one unlimited channel (audit #219).
			if rm.allow("jukebox", rider.ID, h.now(), 300*time.Millisecond) {
				if played, _, refusal := rm.jukeboxWithRefusal(*msg.Jukebox, rider.ID, rider.Name, h.now()); refusal != "" {
					h.writeError(c, jukeboxCode(refusal.code()), refusal.message())
				} else if played != nil && h.xp != nil {
					h.xp.TrackPlayed(channel, played.riderID, played.ref, h.now())
				}
			} else {
				// Skip, pause, queue: deliberate taps a rider watches for a
				// result, so a refused one has to say so (#2232). Every other
				// way this channel refuses already answers — the jukebox's own
				// refusals right above — and the throttle was the one that did
				// not, which reads as the button not working.
				h.writeError(c, jukeboxCode("rate_limited"), "That was quick — give the deck a moment.")
			}
		}
		if msg.Backfill != nil {
			// A reconnect's replay: into the ride record only — stale samples
			// must never repaint anyone's live tile. Batch size is bounded like
			// every other client input.
			samples := msg.Backfill.Samples
			if len(samples) > protocol.MaxBackfillBatch {
				h.log.Warn("backfill truncated", "channel", channel, "rider", rider.ID, "samples", len(samples), "kept", protocol.MaxBackfillBatch)
				samples = samples[:protocol.MaxBackfillBatch]
			}
			// One batch a second: it runs 600 validations under the room's
			// lock, and it was the one channel a member could loop unlimited
			// (audit 2026-09-09).
			if !rm.allow("backfill", rider.ID, h.now(), time.Second) {
				continue
			}
			rm.backfill(c, samples, h.log, h.saver)
			h.log.Debug("backfill received", "channel", channel, "rider", rider.ID, "samples", len(samples))
		}
		if msg.Control != nil {
			// The rider on THIS socket, not the copy captured when it opened:
			// a crew role change mid-session has to land without a reconnect.
			rider := rm.riderOf(c)
			if code, refusal := rm.refusal(msg.Control.Action, rider); code != "" {
				h.writeError(c, code, refusal)
				continue
			}
			if msg.Control.Action == "game" {
				if refusal := rm.startGame(msg.Control.GameMode, rider, h.now()); refusal != "" {
					h.writeError(c, "invalid_request", refusal)
				}
				continue
			}
			if msg.Control.Action == "game-end" {
				if !rm.endGame(h.now()) {
					h.writeError(c, "invalid_request", "No game is running.")
				}
				continue
			}
			if msg.Control.Action == "sprint" {
				// Arm sprint moments: the coach's (matrix), only mid-session.
				if rm.armIfRunning(h.now()) {
					continue
				}
				h.writeError(c, "invalid_request", "Sprints arm during a running session.")
				continue
			}
			if msg.Control.Action == "pick" {
				if refusal := checkPick(*msg.Control); refusal != "" {
					h.writeError(c, "validation_error", refusal)
					continue
				}
			}
			if code, refusal := rm.control(*msg.Control, rider, h.now()); code != "" {
				h.writeError(c, code, refusal)
			}
		}
	}
}

// send queues one already-marshalled frame, never blocking: a socket that has
// stopped reading misses ticks alone rather than taxing the room (#670).
func (c *client) send(frame []byte) bool {
	select {
	case c.out <- frame:
		return true
	default:
		metricDroppedFrames.Inc()
		return false
	}
}

// sendJSON marshals for ONE socket — a refusal, a pairing answer, a poke.
// The tick itself is marshalled once for the whole room instead.
func (c *client) sendJSON(log *slog.Logger, msg protocol.ServerMessage) {
	frame, err := json.Marshal(msg)
	if err != nil {
		logger(log).Error("outbound message could not be marshalled", "err", err)
		return
	}
	c.send(frame)
}

// writeLoop is this socket's only writer, so frames leave in the order they
// were queued and a slow write holds up nothing but this client. It returns
// when the socket's reader returns, when a write fails, or when the keepalive
// finds nobody home — a room socket carries the "in room X" half of presence
// (WhereIs), so it needs the ping as much as the lobby's does (#1506).
func (c *client) writeLoop(done <-chan struct{}, k keepalive) {
	beat := k.beat()
	defer beat.Stop()
	for {
		select {
		case <-done:
			return
		case <-beat.C:
			rtt, alive := k.pingOrClose(context.Background(), c.conn)
			if !alive {
				return
			}
			c.rttMicros.Store(rtt.Microseconds())
		case frame := <-c.out:
			ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
			err := c.conn.Write(ctx, websocket.MessageText, frame)
			cancel()
			if err != nil {
				// A write that failed says the socket is gone as surely as an
				// unanswered ping does, and only the reader's return retires
				// the rider — so close, rather than leaving the reader parked
				// on a socket this goroutine has already given up on.
				_ = c.conn.CloseNow()
				return
			}
		}
	}
}

func logger(log *slog.Logger) *slog.Logger {
	if log == nil {
		return slog.Default()
	}
	return log
}

// jukeboxCode namespaces one of errors.md's codes onto the deck (#2232), so a
// refusal lands beside the control the rider tapped rather than in the room's
// own refusal slot (live.svelte.ts routes on the prefix alone). The suffix is
// always a code from the closed set — the seven `jukebox_queue_full`-shaped
// strings this used to emit were a vocabulary of their own that no client and
// no rule knew (2026-09-17 audit).
func jukeboxCode(code string) string { return "jukebox_" + code }

func (h *Hub) writeError(c *client, code, message string) {
	c.sendJSON(h.log, protocol.ServerMessage{
		Error: &protocol.Error{Code: code, Message: message},
	})
}

// The pick's bounds (audit 2026-09-09): the name and the JSON ride on every
// tick to every socket, and the workout has to be one the editor and the API
// would accept — the WS path was the one that never asked. The numbers are
// the API's (customworkouts.checkDefinition).
const (
	maxWorkoutNameRunes = 80
	maxWorkoutJSONBytes = 64 << 10
	maxSessionSeconds   = 24 * 60 * 60
	metricsMinGap       = 100 * time.Millisecond
)

// checkPick returns the refusal a coach's pick earns, or "" when it may run.
func checkPick(c protocol.Control) string {
	name := strings.TrimSpace(c.WorkoutName)
	if name == "" || utf8.RuneCountInString(name) > maxWorkoutNameRunes {
		return "A workout name has to be 1-80 characters."
	}
	if len(c.WorkoutJSON) > maxWorkoutJSONBytes {
		return "That workout is too large to share with the room."
	}
	if c.TotalSeconds <= 0 || c.TotalSeconds > maxSessionSeconds {
		return "A session runs between a second and a day."
	}
	if err := workout.Validate(c.WorkoutJSON); err != nil {
		if msg, ok := workout.RefusalMessage(err); ok {
			return msg
		}
		return "That is not a workout the engine can ride."
	}
	// Validate bounds the steps; the expansion budget lives in Parse, and the
	// API and the scheduler both ask it first (#1708). A pick that expands
	// past it used to start a session with no blocks: the meter scored
	// nothing and no client would draw it.
	if segments, err := workout.Parse(c.WorkoutJSON); err != nil || len(segments) == 0 {
		return "That workout expands past what a room can ride — fewer repeats, or fewer steps inside them."
	}
	return ""
}
