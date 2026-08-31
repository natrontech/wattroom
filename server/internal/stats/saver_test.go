package stats

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"testing/synctest"
	"time"
)

var errDown = errors.New("postgres down")

func TestRetrySave(t *testing.T) {
	tests := []struct {
		name        string
		failures    int // attempts that fail before success
		wantCalls   int
		wantErr     bool
		wantElapsed time.Duration // backoff waits only; save returns instantly
	}{
		{"first try", 0, 1, false, 0},
		{"recovers after two failures", 2, 3, false, 3 * time.Second},
		{"gives up after saveAttempts", saveAttempts, saveAttempts, true, 127 * time.Second},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				calls := 0
				start := time.Now()
				err := retrySave(context.Background(), slog.New(slog.DiscardHandler), "test",
					func(context.Context) error {
						calls++
						if calls <= tt.failures {
							return errDown
						}
						return nil
					})
				if (err != nil) != tt.wantErr {
					t.Fatalf("err = %v, want error %v", err, tt.wantErr)
				}
				if calls != tt.wantCalls {
					t.Fatalf("calls = %d, want %d", calls, tt.wantCalls)
				}
				if elapsed := time.Since(start); elapsed != tt.wantElapsed {
					t.Fatalf("elapsed = %v, want %v", elapsed, tt.wantElapsed)
				}
			})
		})
	}
}

func TestRetrySaveStopsOnCancel(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		calls := 0
		done := make(chan error, 1)
		go func() {
			done <- retrySave(ctx, slog.New(slog.DiscardHandler), "test",
				func(context.Context) error {
					calls++
					return errDown
				})
		}()
		synctest.Wait() // retrySave is parked in its first backoff wait
		cancel()
		if err := <-done; !errors.Is(err, errDown) {
			t.Fatalf("err = %v, want the last save error", err)
		}
		if calls != 1 {
			t.Fatalf("calls = %d, want 1 — cancel must stop further attempts", calls)
		}
	})
}
