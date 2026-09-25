package gamify

import (
	"context"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"
)

// Shutdown's last step (#2870): XP a session's close queued in its final
// moments is written before the process exits, not dropped with the queue.
func TestDrainWaitsForWhatWasQueuedBeforeIt(t *testing.T) {
	s := New(nil, nil, nil, slog.New(slog.DiscardHandler))
	var ran atomic.Int32
	release := make(chan struct{})
	s.enqueue("slow", func(context.Context) { <-release; ran.Add(1) })
	s.enqueue("queued behind it", func(context.Context) { ran.Add(1) })

	// The worker is stuck on the first job: a drain that cannot finish in
	// time says so rather than pretending.
	if s.Drain(20 * time.Millisecond) {
		t.Fatal("Drain reported an empty queue while a job was still running")
	}
	close(release)
	if !s.Drain(time.Second) {
		t.Fatal("Drain gave up with only fast jobs left")
	}
	if got := ran.Load(); got != 2 {
		t.Errorf("%d of 2 queued jobs ran before Drain returned", got)
	}
}
