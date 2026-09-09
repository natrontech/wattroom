// The background loops main starts beside the listener: the star count the
// landing page shows, and the sweep of expired sessions.
package main

import (
	"github.com/natrontech/wattroom/server/internal/jobmetrics"
	// The zone database, embedded rather than the host's (#858): session mail
	// formats times in each rider's zone, and a distroless image is not where
	// that should depend on what the base layer happens to ship.
	_ "time/tzdata"

	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/natrontech/wattroom/server/internal/safego"
)

// pollStars keeps the repo's star count fresh in the background so the landing
// page reads one number from us instead of every visitor calling GitHub —
// unauthenticated api.github.com allows 60 requests an hour per address, and
// no visitor's address needs to reach GitHub for a star count. Zero means
// unknown (not fetched yet, or GitHub unreachable) and the page hides it.
// ponytail: fixed 15 min refresh, no ETag — stars are not a live metric.
func pollStars(ctx context.Context, log *slog.Logger) *atomic.Int64 {
	var stars atomic.Int64
	safego.Supervise(log, time.Now, "github stars poll", ctx.Done(), func() {
		for {
			n, err := fetchStars(ctx)
			jobmetrics.Ran("github stars poll", err)
			if err != nil {
				log.Warn("github stars unavailable", "err", err)
			} else {
				stars.Store(n)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(15 * time.Minute):
			}
		}
	})
	return &stars
}

func fetchStars(ctx context.Context) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.github.com/repos/natrontech/wattroom", nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("github answered %s", res.Status)
	}
	var body struct {
		Stars int64 `json:"stargazers_count"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&body); err != nil {
		return 0, err
	}
	return body.Stars, nil
}
