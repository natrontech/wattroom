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
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

const tickInterval = time.Second

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
	now    func() time.Time
	mu     sync.Mutex
	rooms  map[string]*room
}

func New(log *slog.Logger, access Access) *Hub {
	return &Hub{log: log, access: access, now: time.Now, rooms: make(map[string]*room)}
}

type room struct {
	slug    string
	mu      sync.Mutex
	clients map[*client]struct{}
	metrics map[string]protocol.RiderMetrics // keyed by rider id, drained each tick
	cheers  []protocol.Cheer                 // this second's reactions, drained each tick
	session *session
	record  *accumulator
	music   *jukebox
}

func newRoom(slug string) *room {
	return &room{
		slug:    slug,
		clients: make(map[*client]struct{}),
		metrics: make(map[string]protocol.RiderMetrics),
		session: newSession(),
		record:  newAccumulator(),
		music:   newJukebox(),
	}
}

type client struct {
	rider protocol.Rider
	conn  *websocket.Conn
	// lastCheer rate-limits reactions: a cheer is a tap, not a firehose.
	lastCheer time.Time
}

// cheerEmoji is the allowlist — reactions, not chat. Free text is a different
// feature with different moderation questions.
var cheerEmoji = map[string]struct{}{
	"🔥": {}, "💪": {}, "👏": {}, "💀": {}, "🚀": {}, "🧊": {},
}

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
	h.log.Info("rider joined", "room", slug, "rider", rider.ID)
	defer func() {
		rm.leave(c)
		_ = conn.CloseNow()
		h.log.Info("rider left", "room", slug, "rider", rider.ID)
	}()

	ctx := r.Context()
	for {
		var msg protocol.ClientMessage
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			return
		}
		if msg.Metrics != nil {
			if m := *msg.Metrics; validMetrics(m) {
				rm.setMetrics(rider.ID, m)
			}
		}
		if msg.Cheer != nil {
			if _, ok := cheerEmoji[msg.Cheer.Emoji]; ok && h.now().Sub(c.lastCheer) >= time.Second {
				c.lastCheer = h.now()
				rm.cheer(protocol.Cheer{Emoji: msg.Cheer.Emoji, From: rider.Name})
			}
		}
		if msg.Jukebox != nil {
			// Any member; the jukebox validates its own input.
			rm.jukebox(*msg.Jukebox, rider.Name, h.now())
		}
		if msg.Backfill != nil {
			// A reconnect's replay: into the ride record only — stale samples
			// must never repaint anyone's live tile. Batch size is bounded like
			// every other client input.
			samples := msg.Backfill.Samples
			if len(samples) > maxBackfillBatch {
				samples = samples[:maxBackfillBatch]
			}
			rm.backfill(rider.ID, samples)
			h.log.Info("backfill received", "room", slug, "rider", rider.ID, "samples", len(samples))
		}
		if msg.Control != nil {
			if !canControl(rider.Role) {
				h.writeError(ctx, c, "forbidden", "Only the owner or a coach controls the session.")
				continue
			}
			if !rm.control(*msg.Control, h.now()) {
				h.writeError(ctx, c, "invalid_request", "That does not work right now — the session is in another phase.")
			}
		}
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
		h.rooms[slug] = rm
		go rm.run(h.now)
	}
	return rm
}

// run broadcasts one tick per interval while anyone is connected. The tick
// always carries the session state and roster — the timer must advance on
// screens even when nobody is pedalling yet.
// ponytail: the ticker runs while the room is empty; rooms are cheap and few,
// stop-on-empty can land with room GC if it ever shows up in a profile.
func (rm *room) run(now func() time.Time) {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()
	for range ticker.C {
		rm.mu.Lock()
		if len(rm.clients) == 0 {
			rm.mu.Unlock()
			continue
		}
		tick := protocol.ServerTick{
			At:      now().UnixMilli(),
			State:   rm.session.state(now()),
			Jukebox: rm.music.snapshot(),
			Cheers:  rm.cheers,
			Riders:  rm.metrics,
			Roster:  make([]protocol.Rider, 0, len(rm.clients)),
		}
		rm.metrics = make(map[string]protocol.RiderMetrics)
		rm.cheers = nil
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
		rm.mu.Unlock()
		// Stable roster order, so tiles do not shuffle every second.
		sort.Slice(tick.Roster, func(i, j int) bool { return tick.Roster[i].ID < tick.Roster[j].ID })

		message := protocol.ServerMessage{Tick: &tick}
		for _, c := range clients {
			ctx, cancel := context.WithTimeout(context.Background(), tickInterval)
			// ponytail: slow consumers just miss ticks; per-client send queues when it matters
			_ = wsjson.Write(ctx, c.conn, message)
			cancel()
		}
	}
}

func (rm *room) join(c *client) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.clients[c] = struct{}{}
}

func (rm *room) leave(c *client) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	delete(rm.clients, c)
	delete(rm.metrics, c.rider.ID)
}

// validMetrics bounds WS input before it touches room state.
func validMetrics(m protocol.RiderMetrics) bool {
	return m.Watts >= 0 && m.Watts <= 3000 &&
		m.HR >= 0 && m.HR <= 250 &&
		m.Cadence >= 0 && m.Cadence <= 250
}

func (rm *room) setMetrics(riderID string, m protocol.RiderMetrics) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.metrics[riderID] = m
	// The live sample is also part of the ride record; a later resend of the
	// same seq dedupes against it.
	if rm.session.phase == "running" {
		rm.record.add(riderID, m)
	}
}

// backfill lands in the record whatever the phase: after a server restart the
// room comes back idle, and dropping the replay then is exactly the data loss
// this exists to prevent. The record is bounded per rider and reset on the
// next start, so out-of-session samples cost nothing and hurt nobody.
func (rm *room) backfill(riderID string, samples []protocol.RiderMetrics) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for _, m := range samples {
		if validMetrics(m) {
			rm.record.add(riderID, m)
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

func (rm *room) jukebox(cmd protocol.JukeboxCommand, addedBy string, now time.Time) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.music.apply(cmd, addedBy, now)
}

func (rm *room) control(c protocol.Control, now time.Time) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	// A new start is a new ride: the record must not blend two sessions.
	if c.Action == "start" {
		rm.record.reset()
	}
	return rm.session.apply(c, now)
}
