// The handlers main mounts that belong to no package: liveness, the version
// the client compares against, and the feedback issuer when one is configured.
package main

import (
	// The zone database, embedded rather than the host's (#858): session mail
	// formats times in each rider's zone, and a distroless image is not where
	// that should depend on what the base layer happens to ship.
	_ "time/tzdata"

	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"runtime/debug"
	"time"

	"github.com/natrontech/wattroom/server/internal/feedback"
	"github.com/natrontech/wattroom/server/internal/store"
)

// issuerOrNil keeps the nil-interface trap out of main: a nil *GitHubIssuer
// wrapped in the interface would not be nil.
func issuerOrNil() feedback.Issuer {
	if g := feedback.GitHubFromEnv(); g != nil {
		return g
	}
	return nil
}

// healthzHandler answers the one question the maintenance page and the deploy
// gate both ask: can this binary serve? It used to write "ok" unconditionally,
// which made it useless for either (ADR-0019). No store configured is
// solo-ride mode — genuinely healthy, not degraded — but a store that has been
// configured and cannot be reached is not.
func healthzHandler(st *store.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if st != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			if err := st.Pool.Ping(ctx); err != nil {
				log.Error("healthz: database unreachable", "err", err)
				http.Error(w, "database unreachable", http.StatusServiceUnavailable)
				return
			}
		}
		_, _ = w.Write([]byte("ok"))
	}
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
	// A tagged build carries its tag; :main and dev builds carry "dev" and must
	// keep carrying it — the updater compares this against the tag it asked for
	// (ADR-0019), so "some build of main" has to compare unequal to every
	// release rather than accidentally matching one.
	version := os.Getenv("WATTROOM_VERSION")
	if version == "" {
		version = "dev"
	}
	body, _ := json.Marshal(map[string]string{"version": version, "commit": commit, "builtAt": builtAt})
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}
}
