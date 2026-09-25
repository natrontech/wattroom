package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"
)

// drain is one thing the stop waits on after the last request: the hub's
// session saves, then the XP a session's close queued while they ran.
type drain struct {
	what string
	wait func(timeout time.Duration) bool
}

// serve runs srv (listen is its ListenAndServe, or Serve on a listener) until
// ctx is cancelled, then stops it: the requests in
// flight finish, then each drain runs in order, all inside one grace so the
// deploy's stop_grace_period bounds the whole stop. It returns only once the
// stop is over (#2870) — Serve returns the moment Shutdown begins, not when
// it ends, and exiting there cut off a ride's save or an upload on every
// deploy. The error is Serve's own failure, never the orderly close.
func serve(ctx context.Context, srv *http.Server, listen func() error, log *slog.Logger, grace time.Duration, drains ...drain) error {
	stopBy := make(chan time.Time, 1)
	go func() {
		<-ctx.Done()
		log.Info("shutting down", "grace", grace)
		deadline := time.Now().Add(grace)
		// Not ctx itself: it is the one already cancelled.
		shutdownCtx, cancel := context.WithDeadline(context.WithoutCancel(ctx), deadline)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Error("shutdown gave up waiting on requests in flight", "err", err)
		}
		stopBy <- deadline
	}()
	if err := listen(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	deadline := <-stopBy
	for _, d := range drains {
		if !d.wait(time.Until(deadline)) {
			log.Error("shutdown gave up waiting on "+d.what, "grace", grace)
		}
	}
	log.Info("shutdown complete")
	return nil
}
