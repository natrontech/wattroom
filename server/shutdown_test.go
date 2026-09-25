package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

// A deploy's SIGTERM used to cut off whatever was in flight (#2870): Serve
// returns as Shutdown begins, and main exited there. serve returns only once
// the request has finished and the drains after it have run.
func TestServeStopsOnlyOnceTheRequestInFlightHasFinished(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var answered, drained atomic.Bool
	srv := &http.Server{
		ReadHeaderTimeout: time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			close(started)
			<-release // a ride's save, mid-write
			answered.Store(true)
			w.WriteHeader(http.StatusNoContent)
		}),
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, sigterm := context.WithCancel(t.Context())
	stopped := make(chan error, 1)
	go func() {
		stopped <- serve(ctx, srv, ln, slog.New(slog.DiscardHandler), 10*time.Second,
			drain{"test", func(time.Duration) bool {
				if !answered.Load() {
					t.Error("a drain ran before the request in flight had finished")
				}
				drained.Store(true)
				return true
			}})
	}()
	saved := make(chan int, 1)
	go func() {
		req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, "http://"+ln.Addr().String()+"/api/rides", nil)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			saved <- 0
			return
		}
		_ = res.Body.Close()
		saved <- res.StatusCode
	}()

	<-started
	sigterm()
	select {
	case <-stopped:
		t.Fatal("serve returned while a request was still in flight")
	case <-time.After(200 * time.Millisecond):
	}
	close(release)
	if code := <-saved; code != http.StatusNoContent {
		t.Errorf("the save in flight answered %d, want 204", code)
	}
	select {
	case err := <-stopped:
		if err != nil {
			t.Errorf("serve: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve never returned after the request finished")
	}
	if !drained.Load() {
		t.Error("the drain never ran")
	}
}
