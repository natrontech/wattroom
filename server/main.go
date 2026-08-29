package main

import (
	"embed"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/natrontech/wattroom/server/internal/fitexport"
	"github.com/natrontech/wattroom/server/internal/hub"
)

// webdist is populated by `make web` (SvelteKit static build). The committed
// placeholder keeps go:embed valid before the first frontend build.
//
//go:embed all:webdist
var webdist embed.FS

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(log)

	h := hub.New(log)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})
	mux.Handle("GET /metrics", promhttp.Handler())
	// The client owns the ride until there is somewhere to persist it (#15); this
	// takes the recorded samples and hands back a file.
	mux.HandleFunc("POST /api/rides/export", fitexport.Handler(log))
	mux.HandleFunc("GET /ws/rooms/{code}", h.HandleWS)
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
