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
