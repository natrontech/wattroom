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
)

// A loop that panics more than Budget times inside Window is a deterministic
// bug, not bad luck: Supervise stops relaunching it and says so, rather than
// spin the same crash. Operational guards, not product numbers.
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
	go supervise(log, now, where, stop, loop)
}

func supervise(log *slog.Logger, now func() time.Time, where string, stop <-chan struct{}, loop func()) {
	var panics []time.Time
	for {
		if !Run(log, where, loop) {
			return
		}
		select {
		case <-stop:
			return
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
			return
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
