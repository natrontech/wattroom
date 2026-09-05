package safego

import (
	"bytes"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

// sink is a logger whose output the test can read back — from another
// goroutine too, which is where Supervise writes.
type sink struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *sink) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *sink) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

func newSink() (*slog.Logger, *sink) {
	s := &sink{}
	return slog.New(slog.NewTextHandler(s, nil)), s
}

func TestRunRecoversAndLogsThePanic(t *testing.T) {
	log, out := newSink()
	if !Run(log, "unit under test", func() { panic("boom") }) {
		t.Fatal("Run did not report the panic")
	}
	got := out.String()
	for _, want := range []string{"goroutine panicked", `where="unit under test"`, "panic=boom", "stack=", "safego_test.go"} {
		if !strings.Contains(got, want) {
			t.Errorf("log lacks %q:\n%s", want, got)
		}
	}
	if Run(log, "quiet", func() {}) {
		t.Fatal("a clean return was reported as a panic")
	}
}

func TestGoSurvivesAPanic(t *testing.T) {
	// Without the recover this test binary would exit here — surviving is
	// the assertion; the log proves it went through the guard. The bubble's
	// Wait returns once the goroutine has exited, log line included.
	synctest.Test(t, func(t *testing.T) {
		log, out := newSink()
		Go(log, "detached", func() { panic("detached work blew up") })
		synctest.Wait()
		if !strings.Contains(out.String(), "where=detached") {
			t.Fatalf("panic was not logged:\n%s", out.String())
		}
	})
}

func TestSuperviseRelaunchesAndGivesUp(t *testing.T) {
	tests := []struct {
		name string
		// step is how far the clock moves between panics: inside Window they
		// count against Budget, outside it they are forgotten.
		step      time.Duration
		panics    int
		stop      bool
		wantRuns  int32
		wantLog   string
		unwantLog string
	}{
		{
			name: "a loop that keeps panicking is relaunched until the budget is spent",
			step: 0, panics: 100,
			wantRuns: Budget + 1, wantLog: "gave up",
		},
		{
			name: "panics spread wider than the window never exhaust the budget",
			step: Window, panics: Budget * 3,
			wantRuns: Budget*3 + 1, wantLog: "restarted after a panic", unwantLog: "gave up",
		},
		{
			name: "a loop whose stop channel is closed is not relaunched",
			step: 0, panics: 100, stop: true,
			wantRuns: 1, unwantLog: "restarted",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// A synctest bubble: Wait returns once the supervisor has exited
			// or blocked for good, so the count below is final, not a race.
			synctest.Test(t, func(t *testing.T) {
				log, out := newSink()
				clock := time.Unix(0, 0)
				now := func() time.Time {
					clock = clock.Add(tt.step)
					return clock
				}
				stop := make(chan struct{})
				if tt.stop {
					close(stop)
				}
				var runs atomic.Int32
				Supervise(log, now, "flaky loop", stop, func() {
					if int(runs.Add(1)) <= tt.panics {
						panic("tick went wrong")
					}
				})
				synctest.Wait()
				if got := runs.Load(); got != tt.wantRuns {
					t.Errorf("loop ran %d times, want %d", got, tt.wantRuns)
				}
				if tt.wantLog != "" && !strings.Contains(out.String(), tt.wantLog) {
					t.Errorf("log lacks %q:\n%s", tt.wantLog, out.String())
				}
				if tt.unwantLog != "" && strings.Contains(out.String(), tt.unwantLog) {
					t.Errorf("log has %q, should not:\n%s", tt.unwantLog, out.String())
				}
			})
		})
	}
}
