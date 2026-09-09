package main

import (
	"errors"
	"os/signal"
	"sync/atomic"
	"syscall"

	// The zone database, embedded rather than the host's (#858): session mail
	// formats times in each rider's zone, and a distroless image is not where
	// that should depend on what the base layer happens to ship.
	_ "time/tzdata"

	"context"
	"embed"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"strings"

	"github.com/natrontech/wattroom/server/internal/account"
	"github.com/natrontech/wattroom/server/internal/auth"
	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/board"
	"github.com/natrontech/wattroom/server/internal/chat"
	"github.com/natrontech/wattroom/server/internal/customworkouts"
	"github.com/natrontech/wattroom/server/internal/dms"
	"github.com/natrontech/wattroom/server/internal/feedback"
	"github.com/natrontech/wattroom/server/internal/fitexport"
	"github.com/natrontech/wattroom/server/internal/friends"
	"github.com/natrontech/wattroom/server/internal/gamify"
	"github.com/natrontech/wattroom/server/internal/gifs"
	"github.com/natrontech/wattroom/server/internal/housekeeping"
	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/mcp"
	"github.com/natrontech/wattroom/server/internal/notify"
	"github.com/natrontech/wattroom/server/internal/og"
	"github.com/natrontech/wattroom/server/internal/playlists"
	"github.com/natrontech/wattroom/server/internal/progression"
	"github.com/natrontech/wattroom/server/internal/recap"
	"github.com/natrontech/wattroom/server/internal/riders"
	"github.com/natrontech/wattroom/server/internal/rides"
	"github.com/natrontech/wattroom/server/internal/rooms"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/strava"
	"github.com/natrontech/wattroom/server/internal/tokens"
	"github.com/natrontech/wattroom/server/internal/tracks"
	"github.com/natrontech/wattroom/server/internal/unfurl"
)

// webdist is populated by `make web` (SvelteKit static build). The committed
// placeholder keeps go:embed valid before the first frontend build.
//
//go:embed all:webdist
var webdist embed.FS

// logLevel reads WATTROOM_LOG_LEVEL, the same shape as WATTROOM_ADDR and
// WATTROOM_DEV_LOGIN rather than a new mechanism. Unset or unreadable means
// info, which is what every deployment has had until now — an operator who
// mistypes it gets the old behaviour and a line saying so, not a silent
// server.
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
	var hubForDrain *hub.Hub

	// The database is optional: unset WATTROOM_DB runs the server as before —
	// solo rides, .fit export, dev — and every DB-backed route stays unmounted,
	// so nothing dark-fails later. Set, it connects and migrates before listening.
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

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", healthzHandler(st, log))
	// Public on purpose, like /api/live below: the registered gauges are
	// aggregate-only by construction (metrics.go refuses a GaugeVec, so no
	// slug or rider reaches this route), and a scraper cannot sign in.
	mux.Handle("GET /metrics", promhttp.Handler())
	mux.HandleFunc("GET /api/version", versionHandler())
	// The client owns the ride until there is somewhere to persist it (#15); this
	// takes the recorded samples and hands back a file.
	mux.HandleFunc("POST /api/rides/export", fitexport.Handler(log))
	if st != nil {
		// The key that seals stored third-party credentials (#697). Absent is
		// allowed and warns; present-but-unusable is fatal, because an
		// operator who set it believes credentials are encrypted and a server
		// that boots anyway makes that belief false and silent. Failing here
		// is what ADR-0019's health gate and rollback are for.
		keys, err := secrets.FromEnv(log)
		if err != nil {
			log.Error("token key", "err", err)
			os.Exit(1)
		}
		// One pass over the rows written before the key existed — off the
		// boot path, with a budget: sealing is not a precondition for
		// serving, and it used to block the listener for as long as the read
		// took (audit 2026-09-09).
		safego.Go(log, "token backfill", func() {
			backfillCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
			defer cancel()
			secrets.Backfill(backfillCtx, st, keys, log)
		})
		if err := auth.DevLoginMisconfigured(baseURL); err != nil {
			log.Error("refusing to start", "err", err)
			os.Exit(1)
		}
		authService := auth.New(st, log, baseURL, strings.HasPrefix(baseURL, "https://"), keys)
		authService.Register(mux)
		accountService := account.New(st, authService, log)
		accountService.Register(mux)
		feedback.New(authService, issuerOrNil(), logRing, log).Register(mux)
		uploader := strava.New(st, log, keys)
		if uploader != nil {
			// Disconnecting Strava hands the grant back, not just our row (#783).
			authService.SetStravaRevoker(uploader)
			// A delivery abandoned by a restart or an outage is retried from
			// its durable record rather than lost with the goroutine (#799).
			uploader.Sweep(ctx)
		}
		roomsService := rooms.New(st, authService, log)
		roomsService.Register(mux)
		// A purge hands the rider's crews on before the row goes (ADR-0038).
		accountService.SetCrews(roomsService)
		// Session-planned email mounts only with WATTROOM_RESEND_KEY set —
		// without it the profile hides the whole notifications section.
		if notifier := notify.New(st, log, baseURL); notifier != nil {
			notifier.Register(mux)
			roomsService.SetNotifier(notifier)
			authService.SetMailer(notifier)
			// The security alarm (#840): account events reach the rider's
			// verified address whether or not they opted into anything.
			accountService.SetAlerter(notifier)
			// Nothing else wakes up to send the hour-before reminder: the
			// other session mails ride the handler that caused them (#841).
			safego.Supervise(log, time.Now, "session reminders", ctx.Done(),
				func() { notifier.RemindLoop(ctx) })
		} else {
			// The unsubscribe link in a rider's inbox outlives the sending key
			// (#1643): it needs the store, not the key.
			notify.Bare(st, log, baseURL).RegisterUnsubscribe(mux)
		}
		customworkouts.New(st, authService, log).Register(mux)
		// Personal read tokens (ADR-0017): bearer auth for GETs of own data
		// and the MCP coach endpoint. Cookie auth stays the write path.
		tokenService := tokens.New(st, authService, log)
		tokenService.Register(mux)
		readAuth := tokenService.ReadSource(authService)
		mcp.New(st, tokenService, log).Register(mux)
		progression.New(st, readAuth, log).Register(mux)
		// One-pass norm_watts fill for pre-ADR-0016 rides; exits when done.
		safego.Go(log, "norm watts backfill", func() { stats.BackfillNormWatts(ctx, st, log) })
		ridesService := rides.New(st, readAuth, log)
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
		hubForDrain = h
		roomsService.SetPresence(h)
		chatService := chat.New(st, roomsService, log)
		chatService.Register(mux)
		h.SetChatKeeper(chatService)
		// And back: a line posted over HTTP from outside the room (#468)
		// reaches the riders inside it on their next tick.
		chatService.SetLive(h)
		// The deletions no write can trigger (#1153, #1163). Sessions and
		// recaps are both bounded by TIME, which nothing but a clock enforces.
		housekeeping.Run(ctx, st, log)
		// What a finished session leaves behind (ADR-0034). The hub writes
		// through it when a session ends; the backlog reads it back, so the
		// card survives the reload every other timeline entry does not.
		recapService := recap.New(st, log)
		h.SetRecapKeeper(recapService)
		recapService.SetLive(h)
		chatService.SetRecaps(recapService)
		playlistsService := playlists.New(st, authService, roomsService, log)
		playlistsService.Register(mux)
		h.SetPlaylistSource(playlistsService)
		h.SetTrackHistory(playlistsService) // #269, what smart shuffle weights by
		playlistsService.SetLive(h)         // #627
		// The trophy case (#467): XP off the bike and achievements. It hears
		// about rides from both savers, about sprints, tracks and sessions
		// from the hub, and about voice minutes from its own ticker.
		trophies := gamify.New(st, readAuth, log)
		trophies.Register(mux)
		saver.SetRideKeeper(trophies)
		ridesService.SetRideKeeper(trophies)
		h.SetXpKeeper(trophies)
		trophies.AccrueVoice(ctx, h)
		friends.New(st, authService, h, log).Register(mux)
		riders.New(st, authService, h, log).Register(mux)
		// The soundboard's durable half (#877, ADR-0033): clips are personal,
		// so the hub is what says whether a listener can hear one.
		board.New(st, authService, h, log).Register(mux)
		tracks.New(st, authService, log).Register(mux)
		dms.New(st, authService, log).Register(mux)
		// The GIF picker (#878, ADR-0032) mounts only with a Giphy key — no
		// button that opens onto a 404.
		if gifService := gifs.New(authService, log); gifService != nil {
			authService.SetGifsEnabled(true)
			gifService.Register(mux)
		}
		// Link previews (#866, ADR-0031): signed-in riders only, and every
		// outbound fetch goes through the package's own SSRF guard.
		unfurl.New(authService, log).Register(mux)
		mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
		// The lobby socket (#251): held by every signed-in client — online for
		// friends, and the push channel that keeps the rail live.
		h.SetLobbyAuth(func(r *http.Request) (string, bool) {
			user, ok := authService.User(r)
			return store.UUIDString(user.ID), ok
		})
		mux.HandleFunc("GET /ws/presence", h.HandleLobbyWS)
		// The landing page's live numbers, public because the page is: riders
		// online right now and the repo's stars. Counts only — no identities,
		// nothing room-scoped.
		// Polled only where a repo is configured (audit 2026-09-09): a
		// self-hoster's box made 96 unsolicited calls a day to fetch a star
		// count for someone else's repository, with no way to turn it off.
		// wattroom.ch sets WATTROOM_GITHUB_REPO for the feedback issues
		// already; a box without it shows no count.
		stars := new(atomic.Int64)
		if os.Getenv("WATTROOM_GITHUB_REPO") != "" {
			stars = pollStars(ctx, log)
		}
		mux.HandleFunc("GET /api/live", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(struct {
				Online int   `json:"online"`
				Stars  int64 `json:"stars"`
			}{h.OnlineCount(), stars.Load()})
		})
		// AV mounts only when LiveKit is configured — no call button that 503s.
		if cfg, ok := av.FromEnv(); ok {
			authService.SetAvEnabled(true)
			avService := av.New(cfg, roomsService, log)
			avService.Register(mux)
			avService.SetVoiceSink(h)
			avService.RegisterWebhook(mux)
			// Webhooks alone leak ghosts when LiveKit hard-crashes (#234).
			avService.StartReconciler(ctx)
			// Bans and removals eject from voice too, not just the metrics WS.
			roomsService.SetVoiceEjector(avService)
		}
	}
	// Link previews: crawlers don't run JS, so og meta + images come from Go (#240).
	var lookup og.LookupRoom
	if st != nil {
		lookup = func(ctx context.Context, slug string) (string, string, bool) {
			room, err := st.Queries.GetRoomBySlug(ctx, slug)
			if err != nil {
				return "", "", false
			}
			return room.Name, room.Icon, true
		}
	}
	social := og.New(baseURL, lookup, log)
	social.Register(mux)
	// Under every API route: an unknown or unmounted path answers the API's
	// own 404, never the SPA shell with a 200 the client then parses as data
	// (#1604).
	mux.HandleFunc("/api/", apiNotFound)
	mux.Handle("/", spaHandler(social))

	addr := ":8080"
	if v := os.Getenv("WATTROOM_ADDR"); v != "" {
		addr = v
	}
	srv := &http.Server{
		Addr:    addr,
		Handler: secured(mux),
		// Header timeout only: /ws connections are long-lived, so no blanket
		// read/write timeouts here — the hub owns per-message deadlines.
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		log.Info("shutting down", "grace", drainGrace)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), drainGrace)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	log.Info("wattroom-server listening", "addr", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("server exited", "err", err)
		os.Exit(1)
	}
	if hubForDrain != nil {
		if hubForDrain.Drain(drainGrace) {
			log.Info("shutdown complete")
		} else {
			log.Error("shutdown gave up waiting on session saves", "grace", drainGrace)
		}
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
