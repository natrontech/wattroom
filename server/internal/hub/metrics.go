package hub

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// The ride vitals #55's alerts watch: the subsystems that go quiet first.
// Registered once at package load; scraped from /metrics.
var (
	metricRiders = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "wattroom_room_riders",
		Help: "Riders currently connected across all rooms.",
	})
	metricTicks = promauto.NewCounter(prometheus.CounterOpts{
		Name: "wattroom_room_ticks_total",
		Help: "Room tick broadcasts sent.",
	})
)

// Riders actually pedalling — a live sample inside ridingWindow — as opposed to
// metricRiders, which counts anyone holding a room socket. The two differ all
// the time: a room between sessions is full of people who are not riding.
//
// The deploy guard on laub-wattroom-001 reads this one. Someone sitting in a
// room can take a five-second restart; someone mid-interval cannot.
//
// A GaugeFunc rather than inc/dec bookkeeping, because riding is a time window
// — it is only true at the moment you ask, and nothing fires an event when a
// sample goes stale.
//
// No label for the room: an aggregate says whether anyone is riding without
// putting room slugs in a metrics endpoint. Metrics are room-scoped by
// architecture and a GaugeVec would quietly widen that.
func (h *Hub) registerRidingMetric() {
	// The process has one hub. Tests build more, and the duplicate registration
	// they cause is ignored on purpose — first hub wins, none of them scrape.
	// Register rather than a package-level sync.Once: no new mutable state.
	_ = prometheus.Register(prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "wattroom_room_riding",
		Help: "Riders with a live sample in the last 10s, across all rooms.",
	}, h.ridingCount))
}

// ridingCount deliberately never holds the hub lock and a room lock at the same
// time: it snapshots the room pointers, lets the hub go, then asks each room on
// its own — the same shape whereIs() already uses (hub.go). A scrape therefore
// cannot wedge a tick, and the critical section is a map scan with no I/O in
// it; the tick loop releases rm.mu before it writes to any socket.
func (h *Hub) ridingCount() float64 {
	h.mu.Lock()
	rooms := make([]*room, 0, len(h.rooms))
	for _, rm := range h.rooms {
		rooms = append(rooms, rm)
	}
	h.mu.Unlock()

	now := h.now()
	riding := 0
	for _, rm := range rooms {
		rm.mu.Lock()
		riding += len(rm.ridingLocked(now))
		rm.mu.Unlock()
	}
	return float64(riding)
}
