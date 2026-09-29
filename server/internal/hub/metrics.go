package hub

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/natrontech/wattroom/server/internal/metrics"
)

// The ride vitals #55's alerts watch: the subsystems that go quiet first.
// Registered once at package load; scraped from /metrics.
var (
	metricRiders = promauto.With(metrics.Registry).NewGauge(prometheus.GaugeOpts{
		Name: "wattroom_room_riders",
		Help: "Riders currently connected across all voice channels.",
	})
	metricTicks = promauto.With(metrics.Registry).NewCounter(prometheus.CounterOpts{
		Name: "wattroom_room_ticks_total",
		Help: "Voice channel tick broadcasts sent.",
	})
	// A socket that has fallen behind its queue (#670). One rider on bad wifi
	// producing a trickle is normal; a climbing rate is a room where somebody
	// is not reading, which is exactly what used to slow everyone else down.
	metricDroppedFrames = promauto.With(metrics.Registry).NewCounter(prometheus.CounterOpts{
		Name: "wattroom_room_frames_dropped_total",
		Help: "Frames dropped because a client's send queue was full.",
	})
)

// Riders whose trainer is connected and talking — a live sample inside
// ridingWindow, watts or no watts — as opposed to metricRiders, which counts
// anyone holding a room socket. The two differ all the time: a room between
// sessions is full of people whose trainer is not on.
//
// Deliberately looser than the rider-facing "riding" (#1016), which now means
// pedalled-recently: someone resting between intervals is not riding, and a
// restart during their rest is still a restart mid-session. The gauge's name
// and Help are unchanged because the deploy guard queries them.
//
// The deploy guard on laub-wattroom-001 reads this one. Someone sitting in a
// room can take a five-second restart; someone mid-interval cannot.
//
// A GaugeFunc rather than inc/dec bookkeeping, because riding is a time window
// — it is only true at the moment you ask, and nothing fires an event when a
// sample goes stale.
//
// No label for the room: an aggregate says whether anyone is riding without
// putting channel ids in a metrics endpoint. Metrics are room-scoped by
// architecture and a GaugeVec would quietly widen that.
//
// Beside it, the roadside (#3022, ADR-0064): sockets watching a running
// session without riding it. Unlabelled for the same reason, and a gauge of
// the service rather than of anybody — WATTROOM.md rules out product
// analytics, and a count of open sockets says how loaded the hub is, never
// who watched whom.
func (h *Hub) registerRideGauges() {
	// Into metrics.Registry, the one the handler serves: since #1738 nothing
	// serves the default registry, so `prometheus.Register` here published the
	// gauge to no one (#2321).
	//
	// The process has one hub. Tests build more, and the duplicate registration
	// they cause is ignored on purpose — first hub wins, none of them scrape.
	// Register rather than a package-level sync.Once: no new mutable state.
	_ = metrics.Registry.Register(prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "wattroom_room_riding",
		Help: "Riders with a live sample in the last 10s, across all voice channels.",
	}, h.ridingCount))
	_ = metrics.Registry.Register(prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "wattroom_room_spectators",
		Help: "Sockets in voice channels with a running session, held by someone not riding it.",
	}, h.spectatorCount))
}

// ridingCount deliberately never holds the hub lock and a room lock at the same
// time: it snapshots the room pointers, lets the hub go, then asks each room on
// its own — the same shape whereIs() already uses (hub.go). A scrape therefore
// cannot wedge a tick, and the critical section is a map scan with no I/O in
// it; the tick loop releases rm.mu before it writes to any socket.
func (h *Hub) ridingCount() float64 {
	rooms := h.liveChannels()

	now := h.now()
	riding := 0
	for _, rm := range rooms {
		rm.mu.Lock()
		riding += rm.liveTrainersLocked(now)
		rm.mu.Unlock()
	}
	return float64(riding)
}

// spectatorCount is ridingCount's shape for the roadside: one room lock at a
// time, never the hub's alongside it.
func (h *Hub) spectatorCount() float64 {
	watching := 0
	for _, rm := range h.liveChannels() {
		rm.mu.Lock()
		watching += rm.spectatorsLocked()
		rm.mu.Unlock()
	}
	return float64(watching)
}

// spectatorsLocked counts the sockets watching this room's running session
// rather than riding it — a phone beside the bike, a desk in the lounge, a
// rider a game has put out. Sockets, not riders: the gauge is load. Nothing
// while no session runs, since then there is nothing to watch. The caller
// holds rm.mu.
func (rm *channelState) spectatorsLocked() int {
	if rm.session.phase != "running" {
		return 0
	}
	watching := 0
	for c := range rm.clients {
		if !rm.session.rides(c.rider.ID) {
			watching++
		}
	}
	return watching
}
