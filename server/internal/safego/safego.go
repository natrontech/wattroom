// Package safego is where a background goroutine's panic stops (#651). The
// server has no shutdown and its live state is in memory: an unrecovered
// panic in one room's loop or one detached save ends the process and drops
// every rider in every room mid-interval. net/http recovers panics on its own
// handler goroutines; everything the server launches itself goes through
// here, so a bad index costs one log line with a stack instead of every ride.
package safego

import (
	"log/slog"
	"runtime/debug"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// A loop that panics more than Budget times inside Window is a deterministic
// bug, not bad luck: Supervise stops relaunching it and says so, rather than
// spin the same crash. Operational guards, not product numbers.
// gaveUp counts loops the supervisor abandoned — the one signal that a
// room's clock, a queue worker or a sweep is gone for good, and until this
// it was a log line nothing alerted on (audit 2026-09-09). No label: a
// room's slug must not reach the metrics route.
var gaveUp = promauto.NewCounter(prometheus.CounterOpts{
	Name: "wattroom_goroutine_gaveup_total",
	Help: "Supervised loops abandoned after repeated panics.",
})

const (
	Budget = 3
	Window = time.Minute
)

// Go runs fn on its own goroutine; a panic in it is logged with where it
// happened and a stack, and the process lives on.
func Go(log *slog.Logger, where string, fn func()) {
	go Run(log, where, fn)
}

// Run calls fn on the caller's goroutine and recovers a panic, reporting
// whether one happened. The building block Supervise relaunches on.
func Run(log *slog.Logger, where string, fn func()) (panicked bool) {
	defer func() {
		if r := recover(); r != nil {
			panicked = true
			logger(log).Error("goroutine panicked", "where", where, "panic", r, "stack", string(debug.Stack()))
		}
	}()
	fn()
	return false
}

// Supervise runs loop on its own goroutine and relaunches it after a
// recovered panic, so a loop that must keep running (a room's clock, a queue
// worker) never stays dead. It stops when loop returns on its own, when stop
// is closed (nil never closes), or when the panics exceed Budget inside
// Window — logged as an error, since at that point restarting is spinning.
// now is injectable for the tests; production passes time.Now.
func Supervise(log *slog.Logger, now func() time.Time, where string, stop <-chan struct{}, loop func()) {
	SuperviseThen(log, now, where, stop, loop, nil)
}

// SuperviseThen is Supervise with a hand-off for the give-up case: when the
// panics exceed Budget, gaveUp runs on the supervisor's goroutine. Without it
// the caller cannot tell a loop that returned on purpose from one the
// supervisor abandoned — and a room whose clock was abandoned keeps its
// sockets open, riders watching a timer that will never move again (#751).
// gaveUp may be nil, and does not run when the loop stops for any other
// reason.
func SuperviseThen(log *slog.Logger, now func() time.Time, where string, stop <-chan struct{}, loop func(), gaveUp func()) {
	go func() {
		if supervise(log, now, where, stop, loop) && gaveUp != nil {
			gaveUp()
		}
	}()
}

// supervise reports whether it stopped because the panics exceeded Budget.
func supervise(log *slog.Logger, now func() time.Time, where string, stop <-chan struct{}, loop func()) bool {
	var panics []time.Time
	for {
		if !Run(log, where, loop) {
			return false
		}
		select {
		case <-stop:
			return false
		default:
		}
		at := now()
		recent := panics[:0]
		for _, p := range panics {
			if at.Sub(p) < Window {
				recent = append(recent, p)
			}
		}
		panics = append(recent, at)
		if len(panics) > Budget {
			logger(log).Error("goroutine gave up after repeated panics", "where", where, "panics", len(panics), "window", Window)
			gaveUp.Inc()
			return true
		}
		logger(log).Warn("goroutine restarted after a panic", "where", where, "panics", len(panics))
	}
}

func logger(log *slog.Logger) *slog.Logger {
	if log == nil {
		return slog.Default()
	}
	return log
}
