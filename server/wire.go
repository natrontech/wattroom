package main

// The services, wired (#3358): everything the server mounts when it has a
// database. Lifted out of main(), whose 376 lines were mostly this block; the
// order and every line of it are as they were.

import (
	"sync/atomic"

	// The zone database, embedded rather than the host's (#858): session mail
	// formats times in each rider's zone, and a distroless image is not where
	// that should depend on what the base layer happens to ship.
	_ "time/tzdata"

	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"

	"strings"

	"github.com/natrontech/wattroom/server/internal/account"
	"github.com/natrontech/wattroom/server/internal/audience"
	"github.com/natrontech/wattroom/server/internal/auth"
	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/avatars"
	"github.com/natrontech/wattroom/server/internal/blocks"
	"github.com/natrontech/wattroom/server/internal/board"
	"github.com/natrontech/wattroom/server/internal/channels"
	"github.com/natrontech/wattroom/server/internal/chat"
	"github.com/natrontech/wattroom/server/internal/crews"
	"github.com/natrontech/wattroom/server/internal/customworkouts"
	"github.com/natrontech/wattroom/server/internal/dms"
	"github.com/natrontech/wattroom/server/internal/emoji"
	"github.com/natrontech/wattroom/server/internal/feedback"
	"github.com/natrontech/wattroom/server/internal/fitexport"
	"github.com/natrontech/wattroom/server/internal/friends"
	"github.com/natrontech/wattroom/server/internal/gamify"
	"github.com/natrontech/wattroom/server/internal/gifs"
	"github.com/natrontech/wattroom/server/internal/housekeeping"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/mcp"
	"github.com/natrontech/wattroom/server/internal/notify"
	"github.com/natrontech/wattroom/server/internal/og"
	"github.com/natrontech/wattroom/server/internal/playlists"
	"github.com/natrontech/wattroom/server/internal/progression"
	"github.com/natrontech/wattroom/server/internal/recap"
	"github.com/natrontech/wattroom/server/internal/riders"
	"github.com/natrontech/wattroom/server/internal/rides"
	"github.com/natrontech/wattroom/server/internal/routes"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/status"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/strava"
	"github.com/natrontech/wattroom/server/internal/tokens"
	"github.com/natrontech/wattroom/server/internal/tracks"
	"github.com/natrontech/wattroom/server/internal/unfurl"
	"github.com/natrontech/wattroom/server/internal/usage"
	"github.com/natrontech/wattroom/server/internal/wallet"
	"github.com/natrontech/wattroom/server/internal/wardrobe"
)

// wired is what main still needs from the wiring: what to drain on shutdown,
// and what a shared crew link may say about the crew.
type wired struct {
	hub      *hub.Hub
	gamify   *gamify.Service
	crewCard og.LookupCrew
}

func wire(ctx context.Context, st *store.Store, mux *http.ServeMux, baseURL string, logRing *feedback.LogRing, log *slog.Logger) wired {
	var hubForDrain *hub.Hub
	var gamifyForDrain *gamify.Service
	// What a shared /c/{code} link may say about a crew (#2445).
	var crewCard og.LookupCrew
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
	//
	// Then the number that says whether it got there (#1038): how many
	// rows are still in the clear, on /metrics and in the log. Started from
	// inside this goroutine rather than beside it so the first sample an
	// operator sees is the post-backfill one, not a pre-backfill count
	// corrected a quarter of an hour later. Watch supervises its own loop
	// and returns.
	safego.Go(log, "token backfill", func() {
		backfillCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		secrets.Backfill(backfillCtx, st, keys, log)
		secrets.Watch(ctx, st.Queries, log)
	})
	// Accounts, signups, riders who ride (#2913). Supervises its own loop.
	usage.Watch(ctx, st.Queries, log)
	if err := auth.DevLoginMisconfigured(baseURL); err != nil {
		log.Error("refusing to start", "err", err)
		os.Exit(1)
	}
	// The other unauthenticated-by-default door, held to the same bar
	// (#2258): its only protection is the value's secrecy.
	if err := auth.SyntheticTokenMisconfigured(); err != nil {
		log.Error("refusing to start", "err", err)
		os.Exit(1)
	}
	// X-Forwarded-For is believed only where the deploy says a proxy
	// writes it (#2258). Unset means the socket's peer, which is right
	// for a binary facing the internet directly and wrong only for the
	// operator who put a proxy in front and did not say so — a case a
	// warning cannot distinguish from an attack.
	httpx.TrustProxyHeader(os.Getenv("WATTROOM_TRUSTED_PROXY") == "1")
	// A rider's sign-in picture is copied onto this origin rather than
	// fetched from Google, GitHub or Strava by every browser that draws
	// their face (#2078) — through the same guarded outbound client the
	// link previews use, because a second one would be a second SSRF
	// surface to keep in step.
	pictures := avatars.New(st, unfurl.NewFetcher(log), log)
	authService := auth.New(st, log, baseURL, strings.HasPrefix(baseURL, "https://"), keys, pictures)
	authService.Register(mux)
	accountService := account.New(st, authService, log)
	accountService.Register(mux)
	feedbackService := feedback.New(authService, issuerOrNil(), logRing, log)
	feedbackService.Register(mux)
	// A purge takes the rider's flag reports off disk too (#2906).
	accountService.SetReportReaper(feedbackService)
	uploader := strava.New(st, log, keys)
	if uploader != nil {
		// Disconnecting Strava hands the grant back, not just our row (#783);
		// so does deleting the account (#1825).
		authService.SetStravaRevoker(uploader)
		accountService.SetStravaRevoker(uploader)
		// A grant taken back on Strava's side is forgotten the same way
		// (#2823), told by Strava's push webhook or found by an upload.
		uploader.SetGrantForgetter(authService.ForgetStravaGrant)
		uploader.Register(mux)
		// A delivery abandoned by a restart or an outage is retried from
		// its durable record rather than lost with the goroutine (#799).
		uploader.Sweep(ctx)
	}
	crewsService := crews.New(st, authService, log)
	// A workout names its road by reference and each reader is handed their
	// cut of it (#3051): the one attacher every workout read goes through.
	roads := routes.NewAttacher(st.Queries)
	crewsService.SetRoads(roads)
	crewsService.Register(mux)
	crewCard = crewsService.CrewCard
	// A purge hands the rider's crews on before the row goes (ADR-0038).
	accountService.SetCrews(crewsService)
	// Session-planned email mounts only with WATTROOM_RESEND_KEY set —
	// without it the profile hides the whole notifications section.
	notifier := notify.New(st, log, baseURL)
	if notifier != nil {
		notifier.Register(mux)
		crewsService.SetNotifier(notifier)
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
	shelf := customworkouts.New(st, authService, log)
	shelf.SetRoads(roads)
	shelf.Register(mux)
	// Personal read tokens (ADR-0017): bearer auth for GETs of own data
	// and the MCP coach endpoint. Cookie auth stays the write path.
	tokenService := tokens.New(st, authService, authService, log)
	tokenService.Register(mux)
	readAuth := tokenService.ReadSource(authService)
	mcp.New(st, tokenService, log).Register(mux)
	progression.New(st, readAuth, log).Register(mux)
	// The accounts that signed in before #2078: their avatar_url still
	// names a provider's host, which the enforced img-src refuses to load,
	// so until this pass converts them those riders draw as an initial.
	// Off the boot path and best-effort — a picture that will not download
	// is not a reason for a server not to serve.
	safego.Go(log, "avatar backfill", func() {
		backfillCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
		defer cancel()
		pictures.Backfill(backfillCtx)
	})
	// One-pass norm_watts fill for pre-ADR-0016 rides; exits when done.
	safego.Go(log, "norm watts backfill", func() { stats.BackfillNormWatts(ctx, st, log) })
	// The same, for last20m_hr on rides saved before #1620 — so a rider's
	// existing 30-minute efforts can suggest an LTHR, not only future ones.
	safego.Go(log, "last-20 HR backfill", func() { stats.BackfillLast20mHR(ctx, st, log) })
	// And the critical-power pair on rides inside the 90-day curve (#3261).
	safego.Go(log, "critical-power backfill", func() { stats.BackfillCriticalPower(ctx, st, log) })
	// Batzen (#3152): each account's one opening grant from the riding it did
	// before the wallet existed; a no-op once every account has one.
	safego.Go(log, "wallet opening grants", func() { wallet.Open(ctx, st, log) })
	// Always private: the session source, never a personal token.
	wallet.New(st, authService, log).Register(mux)
	// Buying, undoing and dressing (#3154): the session source too.
	wardrobe.New(st, authService, log).Register(mux)
	// A rider's stored roads (#3024, ADR-0063): the session source, never
	// readAuth — a personal token is how a coach's AI reads, and no
	// coordinate reaches an AI context.
	routes.New(st, authService, keys, log).Register(mux)
	// The export carries each route's GPX, which needs the key to open.
	accountService.SetRouteKeys(keys)
	ridesService := rides.New(st, readAuth, log)
	if uploader != nil {
		ridesService.SetUploader(uploader)
	}
	ridesService.Register(mux)
	// The client still owns the ride the samples come from (#15) — this
	// encodes a body, it reads no row — but it is a signed-in rider's
	// ride, so it sits in here with the users service (#1547).
	mux.HandleFunc("POST /api/rides/export", fitexport.Handler(authService, log))
	// Live rooms exist only with the durable side present: the WS needs
	// membership, and membership needs the database.
	saver := stats.NewSaver(st, log)
	if uploader != nil {
		saver.SetUploader(uploader)
	}
	// A crew's text and voice channels (ADR-0058). Its door is the hub's:
	// live state keys by voice channel (#2436).
	channelsService := channels.New(st, authService, log)
	channelsService.Register(mux)
	if notifier != nil {
		channelsService.SetNotifier(notifier)
	}
	h := hub.New(log, channelsService, saver)
	hubForDrain = h
	// Who a change the hub sees concerns (#2324) — a socket, a voice
	// roster, the tick — answered from the store, off the hub's lock.
	h.SetAudiences(audience.Hub{Q: st.Queries})
	crewsService.SetPresence(h)
	authService.SetLive(h)
	// An ended session, or a deleted account, takes its open sockets with
	// it (#2807); the key is how the hub spares the session that asked.
	accountService.SetLive(h)
	h.SetSessionKey(auth.SessionKey)
	channelsService.SetLive(h)
	// A crew role change or a hand-over asks the channels' gate again
	// about the sockets and calls already open (#2808).
	crewsService.SetGate(channelsService)
	// A text channel's chat (#2435), behind the channel's own gate; the
	// lobby ping names the channel whose log moved.
	chatService := chat.New(st, log)
	chatService.RegisterChannels(mux, channelsService, h)
	// A crew's own emoji (#2643), behind the crew's gate; the lobby ping
	// is how a picker open elsewhere hears the set changed.
	emoji.New(st, channelsService, h, log).Register(mux)
	// The deletions no write can trigger (#1153, #1163). Sessions and
	// recaps are both bounded by TIME, which nothing but a clock enforces.
	housekeeping.Run(ctx, st, log)
	housekeeping.RunExpiry(ctx, st, log)
	// What a finished session leaves behind (ADR-0034). The hub writes
	// through it when a session ends; the backlog reads it back, so the
	// card survives the reload every other timeline entry does not.
	recapService := recap.New(st, log)
	h.SetRecapKeeper(recapService)
	recapService.SetLive(h)
	playlistsService := playlists.New(st, authService, channelsService, log)
	playlistsService.Register(mux)
	h.SetPlaylistSource(playlistsService)
	h.SetTrackHistory(playlistsService) // #269, what smart shuffle weights by
	playlistsService.SetLive(h)         // #627
	// Hide this rider (#3202): the SQL gates do the HTTP half; the hub
	// reads the in-memory copy on the tick, so it is loaded — and wired
	// in — before the first room opens.
	hidden := blocks.New(st, authService, h, log)
	if err := hidden.Load(ctx); err != nil {
		log.Error("refusing to start", "err", err)
		os.Exit(1)
	}
	h.SetHider(hidden)
	h.SetRoads(roads)
	hidden.Register(mux)
	// The trophy case (#467): XP off the bike and achievements. It hears
	// about rides from both savers, about sprints, tracks and sessions
	// from the hub, and about voice minutes from its own ticker.
	// Both sources, and which route asks which is the rule (#2257):
	// the case's rider route is keyed on someone else's id and takes the
	// cookie source, because ADR-0017 says a token never touches another
	// rider (#1736); the rider's own case is one of the five routes that
	// same amendment says a bearer DOES authenticate, so it takes
	// readAuth.
	trophies := gamify.New(st, authService, readAuth, log)
	gamifyForDrain = trophies
	trophies.Register(mux)
	saver.SetRideKeeper(trophies)
	ridesService.SetRideKeeper(trophies)
	h.SetXpKeeper(trophies)
	trophies.AccrueVoice(ctx, h)
	// The hub says which voice channel; each names it only to a viewer
	// who may enter it (channels.PlacesFor, #2516).
	friends.New(st, authService, h, log).Register(mux)
	// A rider's own status line (ADR-0060): set here, carried beside the
	// name by every surface, and heard elsewhere through the lobby ping.
	status.New(st, authService, h, log).Register(mux)
	riders.New(st, authService, h, log).Register(mux)
	// The soundboard's durable half (#877, ADR-0033): clips are personal,
	// so the hub is what says whether a listener can hear one.
	board.New(st, authService, h, log).Register(mux)
	tracksService := tracks.New(st, authService, log)
	tracksService.Register(mux)
	// A purge takes the rider's uploaded audio off disk with the rows (#1897).
	accountService.SetTrackReaper(tracksService)
	// A poke between friends is a DM line; the hub is how it lands now.
	dms.New(st, authService, h, log).Register(mux)
	// The GIF picker (#878, ADR-0032) mounts only with a Giphy key — no
	// button that opens onto a 404.
	if gifService := gifs.New(authService, log); gifService != nil {
		authService.SetGifsEnabled(true)
		gifService.Register(mux)
	}
	// Link previews (#866, ADR-0031): signed-in riders only, and every
	// outbound fetch goes through the package's own SSRF guard.
	unfurl.New(authService, log).Register(mux)
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
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
		avService := av.New(cfg, channelsService, log)
		authService.SetAvReachable(avService.Reachable)
		avService.Register(mux)
		avService.SetVoiceSink(h)
		avService.RegisterWebhook(mux)
		// Webhooks alone leak ghosts when LiveKit hard-crashes (#234).
		avService.StartReconciler(ctx)
		// Bans and removals eject from voice too, not just the metrics WS;
		// so does a session ending (#2807).
		crewsService.SetVoiceEjector(avService)
		channelsService.SetVoiceEjector(avService)
		h.SetVoiceEjector(avService)
	}
	return wired{hub: hubForDrain, gamify: gamifyForDrain, crewCard: crewCard}
}
