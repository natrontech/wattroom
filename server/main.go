package main

import (
	"os/signal"
	"syscall"

	// The zone database, embedded rather than the host's (#858): session mail
	// formats times in each rider's zone, and a distroless image is not where
	// that should depend on what the base layer happens to ship.
	_ "time/tzdata"

	"context"
	"embed"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"strings"

	"github.com/natrontech/wattroom/server/internal/feedback"
	"github.com/natrontech/wattroom/server/internal/store"
)

// webdist is populated by `make web` (SvelteKit static build). The committed
// placeholder keeps go:embed valid before the first frontend build.
//
//go:embed all:webdist
var webdist embed.FS

func logLevel() slog.Level {
	raw := strings.TrimSpace(os.Getenv("WATTROOM_LOG_LEVEL"))
	if raw == "" {
		return slog.LevelInfo
	}
	var level slog.Level
	if err := level.UnmarshalText([]byte(raw)); err != nil {
		fmt.Fprintf(os.Stderr, "WATTROOM_LOG_LEVEL=%q is not a level (debug, info, warn, error) — using info\n", raw)
		return slog.LevelInfo
	}
	return level
}

func main() {
	// The log ring tees every record into a bounded buffer so a feedback
	// report can staple the server's recent log onto itself (#53). What
	// reaches STDOUT is WATTROOM_LOG_LEVEL's business; the ring keeps Info
	// and above either way (#1098).
	logRing := feedback.NewLogRing(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel()}))
	log := slog.New(logRing)
	slog.SetDefault(log)

	// The process's own context (audit 2026-09-09): every long-lived job
	// runs under it, SIGTERM cancels it, and the server then drains the
	// hub's hand-offs before exiting — the deploy replaces the container
	// the moment the riding gauge drops, which is the moment a session's
	// save starts retrying, and an untracked save died with the process.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	// The one subcommand (#3024): a key rotation's re-seal, run and done.
	if len(os.Args) > 1 && os.Args[1] == "reseal-routes" {
		if err := resealRoutes(ctx, log); err != nil {
			log.Error("reseal-routes", "err", err)
			stop()
			os.Exit(1)
		}
		return
	}

	// The database is optional only in the sense that the binary starts
	// without it: /api/healthz and /api/version answer, every other route
	// stays unmounted and /api/ answers its own 404, so nothing dark-fails
	// later. There is no usable app without it (ADR-0009 — no local-only
	// mode), which is why even the stateless .fit export mounts inside.
	// Set, it connects and migrates before listening.
	var st *store.Store
	if dsn := os.Getenv("WATTROOM_DB"); dsn != "" {
		var err error
		// A deadline on the boot (audit 2026-09-09): a store that hangs —
		// behind another migrator's lock, or a slow first read — answered
		// neither /api/healthz nor /api/version, which is the failure the
		// deploy's rollback handles worst. Loud beats silent.
		openCtx, cancelOpen := context.WithTimeout(ctx, bootBudget)
		st, err = store.Open(openCtx, dsn)
		cancelOpen()
		if err != nil {
			log.Error("store open", "err", err)
			os.Exit(1)
		}
		defer st.Close()
		log.Info("store ready, migrations applied")
	}

	// Public origin for OAuth callbacks and absolute og:image URLs; in dev the
	// Vite proxy forwards /api.
	baseURL := os.Getenv("WATTROOM_BASE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}

	mux := newMux(st, log)
	// Every service, when there is a database to serve (#3358: wire.go).
	var w wired
	if st != nil {
		w = wire(ctx, st, mux, baseURL, logRing, log)
	}
	finishMux(mux, baseURL, w.crewCard, log)

	addr := ":8080"
	if v := os.Getenv("WATTROOM_ADDR"); v != "" {
		addr = v
	}
	startMetricsListener(ctx, log)

	srv := &http.Server{
		Addr:    addr,
		Handler: secured(mux, enforcedCSP(inlineScriptHashes(builtSPA()))),
		// Header timeout only: /ws connections are long-lived, so no blanket
		// read/write timeouts here — the hub owns per-message deadlines.
		ReadHeaderTimeout: 10 * time.Second,
		// A handler panic is a bug nobody is told about at the default INFO
		// the std logger bridges to (#2864); ERROR reaches the alerts.
		ErrorLog: slog.NewLogLogger(log.Handler(), slog.LevelError),
	}
	var drains []drain
	if w.hub != nil {
		drains = append(drains, drain{"session saves", w.hub.Drain})
	}
	if w.gamify != nil {
		drains = append(drains, drain{"queued XP", w.gamify.Drain})
	}
	log.Info("wattroom-server listening", "addr", addr)
	if err := serve(ctx, srv, srv.ListenAndServe, log, drainGrace, drains...); err != nil {
		log.Error("server exited", "err", err)
		os.Exit(1)
	}
}

// drainGrace is how long a shutdown waits for the hub's hand-offs: the ride
// saver's whole retry policy (stats.retrySave: eight attempts, doubling from
// a second) fits inside it. deploy/'s stop_grace_period has to exceed it, or
// the kill lands first.
const drainGrace = 150 * time.Second

// bootBudget is how long connecting and migrating may take before the boot
// gives up and lets the deploy roll back.
const bootBudget = 60 * time.Second
