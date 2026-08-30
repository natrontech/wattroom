package main

import (
	"context"
	"embed"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"strings"

	"github.com/natrontech/wattroom/server/internal/account"
	"github.com/natrontech/wattroom/server/internal/auth"
	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/customworkouts"
	"github.com/natrontech/wattroom/server/internal/feedback"
	"github.com/natrontech/wattroom/server/internal/fitexport"
	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/rides"
	"github.com/natrontech/wattroom/server/internal/rooms"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
)

// webdist is populated by `make web` (SvelteKit static build). The committed
// placeholder keeps go:embed valid before the first frontend build.
//
//go:embed all:webdist
var webdist embed.FS

func main() {
	// The log ring tees every record into a bounded buffer so a feedback
	// report can staple the server's recent log onto itself (#53).
	logRing := feedback.NewLogRing(slog.NewJSONHandler(os.Stdout, nil))
	log := slog.New(logRing)
	slog.SetDefault(log)

	// The database is optional: unset WATTROOM_DB runs the server as before —
	// solo rides, .fit export, dev — and every DB-backed route stays unmounted,
	// so nothing dark-fails later. Set, it connects and migrates before listening.
	var st *store.Store
	if dsn := os.Getenv("WATTROOM_DB"); dsn != "" {
		var err error
		st, err = store.Open(context.Background(), dsn)
		if err != nil {
			log.Error("store open", "err", err)
			os.Exit(1)
		}
		defer st.Close()
		log.Info("store ready, migrations applied")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})
	mux.Handle("GET /metrics", promhttp.Handler())
	// The client owns the ride until there is somewhere to persist it (#15); this
	// takes the recorded samples and hands back a file.
	mux.HandleFunc("POST /api/rides/export", fitexport.Handler(log))
	if st != nil {
		// Public origin for OAuth callbacks; in dev the Vite proxy forwards /api.
		baseURL := os.Getenv("WATTROOM_BASE_URL")
		if baseURL == "" {
			baseURL = "http://localhost:8080"
		}
		authService := auth.New(st, log, baseURL, strings.HasPrefix(baseURL, "https://"))
		authService.Register(mux)
		account.New(st, authService, log).Register(mux)
		feedback.New(authService, issuerOrNil(), logRing, log).Register(mux)
		roomsService := rooms.New(st, authService, log)
		roomsService.Register(mux)
		customworkouts.New(st, authService, log).Register(mux)
		rides.New(st, authService, log).Register(mux)
		// Live rooms exist only with the durable side present: the WS needs
		// membership, and membership needs the database.
		h := hub.New(log, roomsService, stats.NewSaver(st, log))
		roomsService.SetPresence(h)
		mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
		// AV mounts only when LiveKit is configured — no call button that 503s.
		if cfg, ok := av.FromEnv(); ok {
			avService := av.New(cfg, roomsService, log)
			avService.Register(mux)
			avService.SetVoiceSink(h)
			avService.RegisterWebhook(mux)
		}
	}
	mux.Handle("/", spaHandler())

	addr := ":8080"
	if v := os.Getenv("WATTROOM_ADDR"); v != "" {
		addr = v
	}
	srv := &http.Server{
		Addr:    addr,
		Handler: mux,
		// Header timeout only: /ws connections are long-lived, so no blanket
		// read/write timeouts here — the hub owns per-message deadlines.
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Info("wattroom-server listening", "addr", addr)
	if err := srv.ListenAndServe(); err != nil {
		log.Error("server exited", "err", err)
		os.Exit(1)
	}
}

// issuerOrNil keeps the nil-interface trap out of main: a nil *GitHubIssuer
// wrapped in the interface would not be nil.
func issuerOrNil() feedback.Issuer {
	if g := feedback.GitHubFromEnv(); g != nil {
		return g
	}
	return nil
}

// spaHandler serves the embedded SvelteKit build with index.html fallback.
func spaHandler() http.Handler {
	dist, err := fs.Sub(webdist, "webdist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServerFS(dist)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(dist, r.URL.Path[1:]); err != nil && r.URL.Path != "/" {
			r.URL.Path = "/" // SPA fallback: unknown paths get index.html
		}
		fileServer.ServeHTTP(w, r)
	})
}
