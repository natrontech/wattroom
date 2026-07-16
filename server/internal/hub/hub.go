// Package hub owns all live room state in memory: one goroutine per room,
// clients join/leave over WebSocket, and rider metrics are coalesced into one
// tick message per room per second (see WATTROOM.md §3).
package hub

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

const tickInterval = time.Second

type Hub struct {
	log   *slog.Logger
	mu    sync.Mutex
	rooms map[string]*room
}

func New(log *slog.Logger) *Hub {
	return &Hub{log: log, rooms: make(map[string]*room)}
}

type room struct {
	code    string
	mu      sync.Mutex
	clients map[*client]struct{}
	metrics map[string]protocol.RiderMetrics // keyed by rider id, drained each tick
}

type client struct {
	riderID string
	conn    *websocket.Conn
}

// HandleWS upgrades the connection and pumps messages until the client leaves.
func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	rm := h.room(code)
	c := &client{riderID: r.URL.Query().Get("rider"), conn: conn}
	rm.join(c)
	h.log.Info("rider joined", "room", code, "rider", c.riderID)
	defer func() {
		rm.leave(c)
		_ = conn.CloseNow()
		h.log.Info("rider left", "room", code, "rider", c.riderID)
	}()

	ctx := r.Context()
	for {
		var msg protocol.ClientMessage
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			return
		}
		if msg.Metrics != nil {
			rm.setMetrics(c.riderID, *msg.Metrics)
		}
	}
}

func (h *Hub) room(code string) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	rm, ok := h.rooms[code]
	if !ok {
		rm = &room{
			code:    code,
			clients: make(map[*client]struct{}),
			metrics: make(map[string]protocol.RiderMetrics),
		}
		h.rooms[code] = rm
		go rm.run()
	}
	return rm
}

// run coalesces all riders' latest metrics into one tick per interval.
// ponytail: the ticker runs while the room is empty; rooms are cheap and few,
// stop-on-empty lands with room persistence in M2.
func (rm *room) run() {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()
	for range ticker.C {
		rm.mu.Lock()
		if len(rm.metrics) == 0 {
			rm.mu.Unlock()
			continue
		}
		tick := protocol.ServerTick{At: time.Now().UnixMilli(), Riders: rm.metrics}
		rm.metrics = make(map[string]protocol.RiderMetrics)
		clients := make([]*client, 0, len(rm.clients))
		for c := range rm.clients {
			clients = append(clients, c)
		}
		rm.mu.Unlock()

		for _, c := range clients {
			ctx, cancel := context.WithTimeout(context.Background(), tickInterval)
			// ponytail: slow consumers just miss ticks; per-client send queues when it matters
			_ = wsjson.Write(ctx, c.conn, tick)
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
	delete(rm.metrics, c.riderID)
}

func (rm *room) setMetrics(riderID string, m protocol.RiderMetrics) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.metrics[riderID] = m
}
