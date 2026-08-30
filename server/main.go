package main

import (
	"context"
	"embed"
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"runtime/debug"
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
	"github.com/natrontech/wattroom/server/internal/notify"
	"github.com/natrontech/wattroom/server/internal/rides"
	"github.com/natrontech/wattroom/server/internal/rooms"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/strava"
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
	mux.HandleFunc("GET /api/version", versionHandler())
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
		uploader := strava.New(st, log)
		roomsService := rooms.New(st, authService, log)
		roomsService.Register(mux)
		// Session-planned email mounts only with WATTROOM_RESEND_KEY set —
		// without it the profile hides the whole notifications section.
		if notifier := notify.New(st, log, baseURL); notifier != nil {
			notifier.Register(mux)
			roomsService.SetNotifier(notifier)
			authService.SetMailAvailable(true)
		}
		customworkouts.New(st, authService, log).Register(mux)
		ridesService := rides.New(st, authService, log)
		if uploader != nil {
			ridesService.SetUploader(uploader)
		}
		ridesService.Register(mux)
		// Live rooms exist only with the durable side present: the WS needs
		// membership, and membership needs the database.
		saver := stats.NewSaver(st, log)
		if uploader != nil {
			saver.SetUploader(uploader)
		}
		h := hub.New(log, roomsService, saver)
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

// versionHandler reports which build is running. The Go toolchain stamps
// vcs.* into any `go build` from a git checkout, so there are no ldflags to
// maintain; `go run` (dev) carries no stamp and reports "dev".
func versionHandler() http.HandlerFunc {
	commit, builtAt := "dev", ""
	if bi, ok := debug.ReadBuildInfo(); ok {
		var dirty bool
		for _, s := range bi.Settings {
			switch s.Key {
			case "vcs.revision":
				commit = s.Value
				if len(commit) > 7 {
					commit = commit[:7]
				}
			case "vcs.time":
				builtAt = s.Value
			case "vcs.modified":
				dirty = s.Value == "true"
			}
		}
		if dirty && commit != "dev" {
			commit += "+dirty"
		}
	}
	// Docker images build from a gitless context, so no vcs stamp lands in
	// the binary; the publish workflow hands the sha in as WATTROOM_BUILD_SHA.
	if commit == "dev" {
		if sha := os.Getenv("WATTROOM_BUILD_SHA"); sha != "" && sha != "dev" {
			commit = sha
			if len(commit) > 7 {
				commit = commit[:7]
			}
		}
	}
	body, _ := json.Marshal(map[string]string{"commit": commit, "builtAt": builtAt})
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}
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
