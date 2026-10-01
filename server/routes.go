package main

// The routes that are not a service's (#3358): the ones that answer with or
// without a database, the ones under every service route, and the second
// listener that publishes /metrics.

import (
	"errors"

	// The zone database, embedded rather than the host's (#858): session mail
	// formats times in each rider's zone, and a distroless image is not where
	// that should depend on what the base layer happens to ship.
	_ "time/tzdata"

	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"strings"

	"github.com/natrontech/wattroom/server/internal/metrics"
	"github.com/natrontech/wattroom/server/internal/og"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
)

// newMux holds what answers with or without a database.
func newMux(st *store.Store, log *slog.Logger) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", healthzHandler(st, log))
	// /metrics is NOT here any more (#1738). It went out on the public origin
	// under a comment claiming the registered collectors were aggregate "by
	// construction" — which was a convention `jobmetrics` had already broken,
	// beside the Go runtime's own build info and GC statistics. It has its own
	// listener now, below, on a port no edge publishes.
	//
	// The route stays as a 404 that says so: a scrape pointed at the old
	// address otherwise fails as "no such path" on a server that plainly has
	// metrics, which is a worse half-hour than a sentence.
	mux.HandleFunc("GET /metrics", metricsMoved)
	mux.HandleFunc("GET /api/version", versionHandler())
	return mux
}

// finishMux mounts what sits under every service route: the link previews,
// the API's own 404, and the SPA.
func finishMux(mux *http.ServeMux, baseURL string, crewCard og.LookupCrew, log *slog.Logger) {
	// Link previews: crawlers don't run JS, so og meta + images come from Go (#240).
	social := og.New(baseURL, crewCard, log)
	social.Register(mux)
	// Under every API route: an unknown or unmounted path answers the API's
	// own 404, never the SPA shell with a 200 the client then parses as data
	// (#1604).
	mux.HandleFunc("/api/", apiNotFound)
	mux.Handle("/", spaHandler(social))
}

// metricsAddress is where the metrics listener binds (#1738). A separate
// port rather than a path on the public one: what an endpoint publishes
// should not depend on an edge proxy's configuration, and wattroom.ch's edge
// is not deploy/Caddyfile.
//
// Unset means the default; empty means off. The two differ on purpose — an
// operator with no scraper says so by setting it to "".
func metricsAddress() string {
	if v, ok := os.LookupEnv("WATTROOM_METRICS_ADDR"); ok {
		return strings.TrimSpace(v)
	}
	return ":9091"
}

// metricsMux serves the registry at /metrics and nothing anywhere else: a
// stray request to this port must not find an app route, and a misconfigured
// scrape should read as a 404 rather than as an empty scrape.
func metricsMux() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", metrics.Handler())
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "this port serves /metrics and nothing else\n", http.StatusNotFound)
	})
	return mux
}

// startMetricsListener starts the second listener, or says it is off.
func startMetricsListener(ctx context.Context, log *slog.Logger) {
	// The metrics listener (#1738, ADR-0019 amended): its own port, so what
	// it publishes cannot be a question about an edge's configuration. The
	// homelab's Prometheus and the deploy guard reach the container directly
	// and read this one; nothing publishes it to the internet.
	//
	// Empty switches it off, for a deployment with no scraper at all.
	if metricsAddr := metricsAddress(); metricsAddr != "" {
		metricsSrv := &http.Server{
			Addr:              metricsAddr,
			Handler:           metricsMux(),
			ReadHeaderTimeout: 10 * time.Second,
		}
		go func() {
			<-ctx.Done()
			// Not ctx: it is already cancelled by the time this runs.
			shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), drainGrace)
			defer cancel()
			_ = metricsSrv.Shutdown(shutdownCtx)
		}()
		safego.Go(log, "metrics listener", func() {
			log.Info("metrics listening", "addr", metricsAddr, "path", "/metrics")
			// Not fatal: a scrape target that cannot bind must not stop the
			// app from serving rides. It is loud in the log and the alert on
			// the scrape going stale is the one that catches it.
			if err := metricsSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Error("metrics listener exited", "err", err, "addr", metricsAddr)
			}
		})
	} else {
		log.Info("metrics listener off — WATTROOM_METRICS_ADDR is empty")
	}
}
