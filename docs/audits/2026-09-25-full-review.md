# Audit: the whole codebase — 2026-09-25

**The slice.** The whole codebase: `server/`, `web/src/`, `desktop/`, `deploy/`, `scripts/`, `.github/workflows/`, `Makefile`, `Dockerfile` and the migrations. The docs were read both as the baseline and as a subject, for drift. It was the first sweep of the whole tree since [ADR-0058](../decisions/0058-the-room-dissolves-into-the-crew.md) dissolved the room into the crew, so no pre-2026-09-22 audit's "sound" verdict was carried across that line.

**Excluded**:

- Generated code as a subject: `web/src/lib/protocol.ts` and `server/internal/store/db/*.sql.go`. The Go structs and `.sql` queries that generate them were reviewed instead.
- The `/dev/*` mock routes, except as evidence of what the kit offers.
- Real-hardware BLE behaviour. No trainer was attached, so the FTMS code was read and the simulated trainer ridden.
- Strava payloads, which were never read or pasted (AGENTS.md hard rule). The integration code was read.
- Production (wattroom.ch) and `janlauber/homelab`, which were never touched.

**Method.** Read-only, at `ab669885` (origin/main, 2026-09-25). One capture agent, ten lens reviewers, lens 1 re-run as two halves, 33 adversarial verifiers and one dedupe pass: 47 agents in all. The fleet ran from one worktree, against a dev app it ran itself (server :8228, web :5628, its own database). The capture agent seeded a world through the dev door: three riders in one crew with text, voice and private channels, a second crew, a planned session with mixed answers, a ridden session with a recap, a DM, a friend, a pending request, status lines, an announcement, a pin and an unread line. It then took **384 screenshots** of the 42 routes in `web/e2e/routes.ts` at 1440×900 and 375×812, in light and dark, signed in and out. Each shot has its visible text and accessibility tree beside it. It also captured the states: loading, empty, error, WS dropped, trainer dropout, count-in, mid-ride in `/ride` and in a session, the summary and the HUD. Lenses 1–4, 9 and 10 read code first. Lenses 5–8 read the capture set and drove the app with their own riders. 94 findings were reproduced in the running app or in a test run, and the rest were read from the code.

**Findings by lens and severity** (after verification; the two refuted findings are left out):

| Lens | critical | high | medium | low | total |
| --- | --- | --- | --- | --- | --- |
| 1a — server authz and revocation | 0 | 1 | 3 | 0 | 4 |
| 1b — server auth, fetch, uploads | 0 | 2 | 2 | 1 | 5 |
| 2 — client, desktop, supply chain | 0 | 3 | 4 | 3 | 10 |
| 3 — privacy and lifecycle | 0 | 5 | 5 | 1 | 11 |
| 4 — live state | 0 | 3 | 5 | 8 | 16 |
| 5 — rider journeys | 0 | 2 | 7 | 6 | 15 |
| 6 — density | 0 | 0 | 7 | 10 | 17 |
| 7 — UX rules | 0 | 0 | 8 | 7 | 15 |
| 8 — visual, a11y, phone | 0 | 0 | 8 | 7 | 15 |
| 9 — code health, drift | 0 | 0 | 4 | 13 | 17 |
| 10 — performance | 0 | 0 | 6 | 3 | 9 |
| **all** | **0** | **16** | **59** | **59** | **134** |

Nothing is critical after verification. Lens 1a rated the channel-delete ride loss (#2816) critical, and its verifier moved it to high: the IndexedDB copy can still be downloaded as a `.fit`, and the trigger is a deliberate admin action.


## Filed

The rule was **kind is bug, security or privacy, or severity is medium or higher → its own issue**. Lows that missed it were bundled into one issue per lens and area. A plausible finding (verified, but the decisive step could not be closed) was filed only at medium or higher, and its issue says it is unverified. Duplicates across lenses were merged, and each merged issue carries every lens's evidence (the table marks the member rows "merged"). Every issue stands alone: the symptom, `path:line` evidence, a proposed fix and a provenance footer. The footer names the lens and says whether a verifier confirmed the finding, reproduced it, or read it from code, and it gives this audit and `ab669885`. Sequencing notes and cross-links name the finding ids and their issue numbers, in both directions.

**What the orchestrator verified itself.** Every confirmed high finding was re-read in the cited code before filing (#2804–#2816), and all held. Twenty of the roughly 100 findings no verifier looked at were spot-checked against the code: one in five, marked "spot-checked" below, all consistent with their claims. The rest are marked "unverified" and say so in their footers.

**Issues filed: #2804–#2872** (69 issues of their own, three of them decisions) and **#2873–#2889** (17 bundles). One finding went to an existing issue as new evidence rather than a new issue: L10-06, the measured cost of an unrouted lobby ping, is now a comment on #2324. The comment also links the privacy half of the same ping (#2821). #1038 has a comment pointing to #2836 before anyone runs its contract.


### Lens 1a — Security — server: authorization and live revocation

| # | Finding | Severity | Kind | Verified |
| --- | --- | --- | --- | --- |
| #2816 | L1a-01 fix(channels): deleting a voice channel while a session runs in it discards every rider's session ride | high | bug | confirmed · reproduced |
| #2812 (merged) | L1a-02 fix(og): GET /c/{code} is an unmetered crew-name and code-validity oracle that bypasses the door's guess budget | medium | security | confirmed · reproduced |
| #2808 (merged) | L1a-03 fix(crews): handing a crew on never re-roles the open live sockets, so the new owner cannot end a session until they reconnect | medium | bug | confirmed · code |
| #2807 (merged) | L1a-04 fix(auth): sign-out-everywhere, recovery and account deletion never eject the rider from a live LiveKit call | medium | privacy | confirmed · code |

### Lens 1b — Security — server: auth, outbound fetch, uploads, secrets, ceilings

| # | Finding | Severity | Kind | Verified |
| --- | --- | --- | --- | --- |
| #2811 | L1b-01 fix(auth): a personal token minted from a stolen session survives sign-out-everywhere and account recovery | high | security | confirmed · reproduced |
| #2812 | L1b-02 fix(og): the /c/{code} SPA meta lookup is an unauthenticated, unbudgeted crew-existence and name oracle | high | security | confirmed · reproduced |
| #2825 | L1b-03 fix(budget): a flood of distinct keys fails the per-address ceilings closed, locking new IPs out of sign-in | medium | security | confirmed · reproduced |
| #2862 | L1b-04 perf(tracks): uploads buffer the whole body before any quota check and carry no per-account rate limit | medium | perf | confirmed · reproduced |
| #2865 | L1b-05 fix(auth): passkey login does not require user verification, so an assertion with UV unset is accepted | low | security | confirmed · reproduced |

### Lens 2 — Security — client, desktop and supply chain

| # | Finding | Severity | Kind | Verified |
| --- | --- | --- | --- | --- |
| #2804 (merged) | L2-01 fix(web): a rider can neither see nor stop their heart rate going to the session — #75's control was deleted as dead code | high | privacy | confirmed · code |
| #2805 (merged) | L2-02 fix(web): the next rider to sign in on a browser inherits the last one's heart-rate ride and LTHR | high | privacy | confirmed · reproduced |
| #2806 | L2-03 fix(ci): the CI jobs that run third-party code hold a write token on main and on every same-repo PR | high | security | confirmed · code |
| #2817 | L2-04 fix(web): a chat link to &lt;origin>//host is drawn as ours and replaces the app in the same tab | medium | security | confirmed · reproduced |
| #2818 | L2-05 fix(desktop): Windows and Linux self-updates install whatever the release feed serves, unsigned | medium | security | plausible · code |
| #2826 | L2-06 fix(desktop): Settings offers Connect Google/GitHub/Strava and Add a passkey in the shell, where ADR-0040 says both dead-end | medium | ux | unverified |
| #2827 | L2-07 fix(deploy): the self-hosting compose cannot reach LiveKit — Caddy proxies its own localhost, and LiveKit posts webhooks to a name it cannot resolve | medium | bug | spot-checked |
| #2866 | L2-08 chore(ci): ADR-0054's pin-by-commit rule stops at actions — the image stages and air run whatever their tag names today | low | decision | unverified |
| #2873 (bundle) | L2-09 docs(server): the CSP comment says 'unsafe-inline' is only for the theme block — SvelteKit's per-build boot script is inline too | low | drift | unverified |
| #2828 (merged) | L2-10 fix(desktop): the shell's own words still say room — the offline screen and the macOS permission prompts | low | drift | unverified |

### Lens 3 — Privacy and data lifecycle

| # | Finding | Severity | Kind | Verified |
| --- | --- | --- | --- | --- |
| #2807 | L3-01 fix(hub): sign-out-everywhere, recovery and account deletion leave the rider's open sockets receiving live data | high | security | confirmed · reproduced |
| #2808 | L3-02 fix(channels): making a voice channel private, or demoting an admin, leaves the excluded riders inside its live tick | high | privacy | confirmed · reproduced |
| #2805 | L3-03 fix(web): a rider's unsaved ride, heart rate included, survives sign-out and deletion and is offered to the next account on that browser | high | privacy | confirmed · reproduced |
| #2804 | L3-04 fix(web): the 'sharing heart rate · stop sharing' control ADR-0008 requires is gone, and trainer-relayed HR goes to the whole call | high | privacy | confirmed · code |
| #2809 | L3-05 fix(hub): deleting an account mid-session still leaves the rider named in the recap written when the session ends | high | privacy | confirmed · reproduced |
| #2819 | L3-06 fix(hub): a finished session's per-rider execution scores stay on every tick for anyone who joins the channel later | medium | privacy | confirmed · reproduced |
| #2820 | L3-07 fix(crews): turning a crew's board on puts everyone who joined while it was off on the board | medium | decision | unverified |
| #2821 | L3-08 fix(hub): the lobby ping announces every write in a private text channel, by id, to every signed-in socket | medium | privacy | confirmed · reproduced |
| #2822 | L3-09 fix(feedback): one rider's flag stores the last 400 server log lines about everyone, forever, while the UI says 'only yours' | medium | privacy | confirmed · reproduced |
| #2823 | L3-10 fix(strava): a rider who revokes WattRoom on Strava's side keeps their tokens and activity ids with us indefinitely | medium | privacy | confirmed · code |
| #2863 | L3-12 fix(account): the export leaves out user columns and rows the rider authored | low | privacy | confirmed · reproduced |

### Lens 4 — Live state and server correctness

| # | Finding | Severity | Kind | Verified |
| --- | --- | --- | --- | --- |
| #2808 (merged) | L4-01 fix(channels): making a voice channel private, or demoting an admin, leaves the live socket and call open | high | security | confirmed · reproduced |
| #2813 | L4-02 fix(hub): a paused session that everyone leaves is never closed, saved or released | high | bug | confirmed · reproduced |
| #2814 | L4-03 fix(hub): session rides are saved by arrival index — late joiners and reconnect replays are mis-scored, mis-ordered and misdated | high | bug | confirmed · code |
| #2829 | L4-04 fix(hub): a coach's hand-off drafts a spectator or free rider into the session and takes over their trainer | medium | drift | spot-checked |
| #2830 | L4-05 fix(hub): a game started inside a workout session outlives it — everyone is eliminated and a random rider wins | medium | bug | spot-checked |
| #2831 | L4-06 fix(game): riders eliminated on the same tick are placed by map order, so the winner is random | medium | bug | spot-checked |
| #2832 | L4-07 fix(game): a page reload during Sprint Roulette or Points Race ranks the rider below everyone for the rest of the game | medium | bug | unverified |
| #2833 | L4-08 fix(stats): Diesel is awarded to the first joiner when the session has no steady step | medium | bug | spot-checked |
| #2867 | L4-09 fix(hub): reaping a stale socket releases the trainer claim its reconnected tab still holds | low | bug | unverified |
| #2868 | L4-10 fix(hub): a session's length is checked against the client's number, not the workout's | low | bug | unverified |
| #2869 | L4-11 fix(hub): away and back are unthrottled — one member can flood the channel's timeline and crowd out real lines | low | bug | unverified |
| #2874 (bundle) | L4-12 fix(hub): the autoplay worker's database read has no deadline, and its dropped jobs are not measured | low | perf | unverified |
| #2870 | L4-13 fix(server): shutdown does not wait for srv.Shutdown, so in-flight requests die on every deploy | low | bug | unverified |
| #2834 (merged) | L4-14 decision(gamify): DJ is earned from a client-reported 'ended', but SPEC says client-reported claims never earn trophies | low | decision | unverified |
| #2875 (bundle) | L4-15 docs: ADR-0012 still says the sockets ping every 30 s, and SPEC's Daily Load still says UTC | low | drift | unverified |
| #2876 (bundle) | L4-16 chore(hub): tick.go, hub.go, protocol.go and notify.go are 40–100 % over the ~400-line ceiling | low | debt | unverified |

### Lens 5 — Rider journeys

| # | Finding | Severity | Kind | Verified |
| --- | --- | --- | --- | --- |
| #2815 | L5-01 fix(crews): a founder deleting their account breaks the crew list for everyone left in the crew | high | bug | confirmed · reproduced |
| #2810 | L5-02 fix(web): joining by code from Home or the sidebar skips the crew door, so a rider lands on the weekly board unwarned | high | privacy | confirmed · reproduced |
| #2864 | L5-03 fix(auth): /start and /callback of the dev and synthetic providers dereference a nil OAuth config | low | security | confirmed · reproduced |
| #2824 | L5-04 docs(web): the door, Your data and /privacy still say live numbers stay inside the session, but a free ride shows them, heart rate included, to the voice channel | medium | privacy | confirmed · code |
| #2842 (merged) | L5-05 fix(web): Undo after removing a friend fails for any friend added by code, and the refusal says 'room' | medium | bug | unverified |
| #2843 | L5-06 fix(web): the app does not treat a free ride as a ride: no cave, no desktop HUD, no leave guard | medium | bug | spot-checked |
| #2844 | L5-07 fix(web): the desktop app's first screen and the browser hand-off both say no sign-in providers are configured | medium | ux | unverified |
| #2845 (merged) | L5-08 fix(web): a crew page, text channel, Rides or invite door opened on a slow connection is a blank screen until its read returns | medium | ux | unverified |
| #2846 (merged) | L5-09 fix(web): a friend's long status pushes the DM page 283 px sideways at 375 px and squeezes the composer to about 70 px | medium | ux | unverified |
| #2847 | L5-10 fix(auth): a cancelled or stale OAuth sign-in lands on a raw JSON error with no way back | medium | ux | spot-checked |
| #2848 (merged) | L5-11 fix(web): while the crew list loads or fails, Home's big button is 'Start a crew' and the setup card miscounts | low | ux | unverified |
| #2871 | L5-12 fix(stats): a ride ended inside the warm-up is stored as 0 % execution, though its summary said — | low | bug | unverified |
| #2879 (bundle) | L5-13 fix(web): Disconnect on the account's only sign-in renders, asks for confirmation, then refuses | low | ux | unverified |
| #2880 (bundle) | L5-14 fix(web): a crew page left open when its rider is banned keeps the code, the roster and a Retry that cannot succeed | low | ux | unverified |
| #2880 (bundle) | L5-15 fix(web): the Schedule's Start now opens a session without the 'Start without a trainer' choice | low | ux | unverified |

### Lens 6 — Information density and status redundancy

| # | Finding | Severity | Kind | Verified |
| --- | --- | --- | --- | --- |
| #2849 | L6-01 fix(web): the people column files online riders under "offline", yourself included when the channel socket is refused | medium | bug | spot-checked |
| #2850 (merged) | L6-02 fix(web): one voice failure is said four times, with two recovery buttons and three wordings | medium | ux | unverified |
| #2851 (merged) | L6-03 fix(web): during a trainer dropout the big number keeps glowing the last sample "on target", and the crew still sees the rider holding target | medium | bug | unverified |
| #2852 | L6-04 fix(web): the voice strip draws the riders a fourth time on the channel's own Training place and session page | medium | density | unverified |
| #2853 | L6-05 fix(hub,web): the sidebar session line and the crew page count everyone standing in the channel as riding the session | medium | bug | spot-checked |
| #2854 | L6-06 fix(web): "in voice" names riders who are not on the call; standing in a channel has five names | medium | ux | unverified |
| #2855 (merged) | L6-07 fix(web): the connection banner's "0:00 of riding is stored here" never counts, and says it where nobody rides | medium | bug | unverified |
| #2881 (bundle) | L6-08 fix(web): a trainer dropout reads differently on the two riding surfaces, and solo says "reconnecting" twice | low | drift | unverified |
| #2882 (bundle) | L6-09 fix(web): execution is drawn twice on the session screen, and the people column's target watts reads as a second live number | low | density | unverified |
| #2872 | L6-10 decision: the status line grew from ADR-0060's five surfaces to ~24, onto the riding surface | low | decision | unverified |
| #2882 (bundle) | L6-11 fix(web): Home shows a friend in voice twice, under a line that says nobody is around | low | density | unverified |
| #2882 (bundle) | L6-12 fix(web): "not in voice" is said three times and a white Join voice is the loudest control on every riding screen | low | ux | unverified |
| #2882 (bundle) | L6-13 fix(web): the narrow cockpit shows your own watts twice; a phone spectator sees the followed rider twice | low | density | unverified |
| #2882 (bundle) | L6-14 fix(web): "starting soon" glows, and the mark glows on every screen whether or not anything runs | low | drift | unverified |
| #2883 (bundle) | L6-15 fix(web): the channel log keeps "Recovery Spin is starting" after it started and after it ended | low | ux | unverified |
| #2882 (bundle) | L6-16 fix(web): on a phone the voice channel page never says which channel it is, and camera-less riders fill it with blank tiles | low | density | unverified |
| #2882 (bundle) | L6-17 docs: the people column is 320 px wide; ADR-0020's budget is 272 | low | drift | unverified |

### Lens 7 — UX rules conformance

| # | Finding | Severity | Kind | Verified |
| --- | --- | --- | --- | --- |
| #2851 | L7-01 fix(web): a trainer dropout keeps the last watts glowing and 'on target' under the signal-lost banner | medium | ux | unverified |
| #2855 | L7-02 fix(web): the WS-drop banner's 'stored here' clock and the elimination grace countdown are frozen at 0:00 / 30 s | medium | bug | spot-checked |
| #2845 | L7-03 fix(web): a slow API blanks the whole app on 20 routes — blocking load() with ssr off draws no shell, no skeleton, no pending state | medium | ux | spot-checked |
| #2850 | L7-04 fix(server,web): Join voice renders enabled while LiveKit is unreachable, and the failure blames the rider's network and says 'didn't come back' | medium | ux | unverified |
| #2848 | L7-05 fix(web): a pending or failed read draws the empty state's call to action — Home's big 'Start a crew', Music's 'Add the first tracks', the sidebar's 'Message a friend' | medium | ux | unverified |
| #2837 | L7-06 fix(crews): a crew's last owner can neither leave nor delete it — the empty-crew sweep of #1935/#2079 went with the rooms package | medium | bug | spot-checked |
| #2842 | L7-07 fix(friends): Undo on 'Withdrew your request' / 'Removed as a friend' fails for a code-made friendship — 'No rider there that you share a room with' | medium | bug | spot-checked |
| #2846 | L7-08 fix(web): a DM at phone width scrolls sideways 283 px when the friend has a long status — the composer shrinks to ~70 px | medium | ux | unverified |
| #2828 (merged) | L7-09 fix(server): rider-facing copy still says 'room' — refusals, an achievement, the account-deleted mail and the desktop offline page | low | drift | unverified |
| #2884 (bundle) | L7-10 fix(web): deleting a playlist lives only in its context menu, and its Undo cannot restore a voice channel's autoplay | low | ux | unverified |
| #2885 (bundle) | L7-11 fix(web): removing the crew picture and taking a member out of a private channel skip both the undo and the ask | low | ux | unverified |
| #2885 (bundle) | L7-12 fix(web): ride-critical status vanishes when a free-riding rider opens a chat channel — the ride keeps recording off-screen | low | ux | unverified |
| #2886 (bundle) | L7-13 fix(web): 'Start a session' in the free-ride header is 38 px while the rider pedals | low | a11y | unverified |
| #2886 (bundle) | L7-14 fix(web): standalone 16–17 px targets on browse surfaces at 375 — 'Save a copy' on every curated workout, the shelf's Build/Import links, 'Advanced' folds | low | a11y | unverified |
| #2887 (bundle) | L7-15 docs: errors.md says confirm() owns the safe answer and call sites don't restate it — the code makes every call site pass one, in six spellings | low | drift | unverified |

### Lens 8 — Visual system, accessibility, phone width

| # | Finding | Severity | Kind | Verified |
| --- | --- | --- | --- | --- |
| #2856 | L8-01 fix(web): zone colours are drawn as text below ADR-0023's floors, so the zone name under the big number is 2.1:1 mid-ride | medium | a11y | unverified |
| #2851 (merged) | L8-02 fix(web): the big number keeps glowing, and still says 'on target', while the trainer signal is lost | medium | ux | unverified |
| #2846 (merged) | L8-03 fix(web): a friend's status line pushes the DM page 283–296 px sideways on a phone | medium | bug | unverified |
| #2857 | L8-04 fix(web): the message composer leaves 72 px to type in on a phone DM | medium | ux | unverified |
| #2858 | L8-05 fix(web): accent colours are back on 10–14 px words below 4.5:1 — btn-accent in every light theme, neon labels in the dark | medium | a11y | spot-checked |
| #2859 | L8-06 fix(web): white on the neon fill — the level chip and the checkbox tick are 2.06:1 in Monokai, and the chip digit is 7 px | medium | a11y | unverified |
| #2860 | L8-07 fix(web): in Windows high-contrast mode the power gauge vanishes from the riding screen | medium | a11y | spot-checked |
| #2861 | L8-08 fix(web): checkbox and text-field edges are under 3:1 — an unchecked box is 1.55:1 in the light themes | medium | a11y | unverified |
| #2888 (bundle) | L8-09 fix(web): text faded with opacity gets past the no-faded-text gate — locked badges and medals read at 3.1:1 | low | a11y | unverified |
| #2888 (bundle) | L8-10 fix(web): cancelling 'Leave the crew' drops keyboard focus onto the page body | low | a11y | unverified |
| #2888 (bundle) | L8-11 fix(web): on a phone, the 'watching …' label is covered by the top of the big number | low | ux | unverified |
| #2886 (bundle) | L8-12 fix(web): 'Unpair trainer' is a 28 px text button in a running session's header | low | ux | unverified |
| #2888 (bundle) | L8-13 fix(web): the drawer, the right-hand sheet and the watt number still animate under prefers-reduced-motion | low | a11y | unverified |
| #2889 (bundle) | L8-14 docs: routes.ts says a session is measured on a phone, but the spec measures a desk at 375 and cites a fixme that is gone | low | drift | unverified |
| #2888 (bundle) | L8-15 chore(web): the colour guard misses hsl()/rgba()/named colours, and no duration tokens exist for 'durations from theme tokens' | low | debt | unverified |

### Lens 9 — Code health, consolidation, doc drift

| # | Finding | Severity | Kind | Verified |
| --- | --- | --- | --- | --- |
| #2835 | L9-01 fix(web): the next block's watts ignore the rider's bias on /ride, in a session and on the TV | medium | bug | spot-checked |
| #2836 | L9-02 docs: ADR-0019 never says a sqlc `select *` is a use; #1038 as written breaks rollback of every OAuth sign-in | medium | drift | unverified |
| #2837 (merged) | L9-03 decision(crews): since ADR-0058 no crew can ever be deleted, yet SPEC says deleting one frees a founding slot | medium | decision | unverified |
| #2828 | L9-04 fix(server): riders still read "room" in refusals, the account-deleted email and the friend-request 404 | medium | ux | spot-checked |
| #2876 (bundle) | L9-05 refactor: 44 source files are over code-quality.md's size ceilings, and the known ones have grown | low | debt | unverified |
| #2876 (bundle) | L9-06 refactor(server): account.go's handleExport is one 732-line function | low | debt | unverified |
| #2876 (bundle) | L9-07 refactor(web): /ride and /ramp repeat the ride-sounds and signal-lost wiring; session.svelte.ts is a 580-line closure | low | debt | unverified |
| #2876 (bundle) | L9-08 refactor: shared product numbers and predicates are restated in 2-4 places instead of protocol/limits.go | low | debt | unverified |
| #2876 (bundle) | L9-09 chore: ADR-0058 identifier leftovers — inRoom/roomName on the wire, the hub's `room`, and comments pointing at closed issues | low | debt | unverified |
| #2876 (bundle) | L9-10 chore(gamify): the server catalogue's Name and How are never read, and have drifted from the client's | low | debt | unverified |
| #2876 (bundle) | L9-11 chore(store): validating crews_code_present was orphaned when #2333 closed as superseded | low | debt | unverified |
| #2876 (bundle) | L9-12 test(server): crew-scoped writes still have no signed-out 401 case | low | debt | unverified |
| #2875 (bundle) | L9-13 docs: ARCHITECTURE says the crew invariants table runs every visibility query; it runs three | low | drift | unverified |
| #2876 (bundle) | L9-14 fix(auth): the dev door silently maps any name with a digit or hyphen to the one shared Dev Rider | low | debt | unverified |
| #2875 (bundle) | L9-15 docs(spec): stale and missing numbers — Daily Load still says UTC, and the code carries unspecced game-mode numbers | low | drift | unverified |
| #2877 (bundle) | L9-16 perf(server): the crew channel list ships every voice channel's full presence and no client reads it | low | perf | unverified |
| #2876 (bundle) | L9-17 chore: `make check` is declared phony, has no recipe, and exits 0 | low | debt | unverified |

### Lens 10 — Performance and endurance

| # | Finding | Severity | Kind | Verified |
| --- | --- | --- | --- | --- |
| #2838 | L10-01 perf(hub): the whole jukebox queue rides every tick, 85–97 % of each frame, uncompressed | medium | perf | spot-checked |
| #2834 | L10-02 fix(hub): an unplayable video counts as played to the end, so the DJ achievement awards itself | medium | bug | unverified |
| #2839 | L10-03 fix(web): a reconnect's replay drops each sample's bias and released flag, and a replay over an hour loses its newest part | medium | bug | spot-checked |
| #2840 | L10-04 perf(web): every voice channel loads the YouTube player (1.1 MB from Google) before anything is queued, and it runs all ride | medium | perf | unverified |
| #2841 (merged) | L10-05 perf(store): the DM list scans all of dm_messages on every 10 s poll from every signed-in tab | medium | perf | unverified |
| #2324 (comment) | L10-06 perf(server): each lobby ping costs an open session page ~11 requests, including two sequential scans of crews | medium | perf | unverified |
| #2841 | L10-07 perf(store): foreign keys lost their indexes in the ADR-0058 move, so deleting a channel scans every ride | low | perf | spot-checked |
| #2878 (bundle) | L10-08 perf(web): the ride graph re-serialises the whole ride through a deep $state proxy every second | low | perf | unverified |
| #2868 (merged) | L10-09 fix(hub): a session may run 24 h but the ride record silently stops at 6 h | low | drift | unverified |

## Triaged but not filed

- **L3-11 — refuted.** Crew tiles and the weekly board count rides in private channels. The verifier found this is what the canon asks for. ADR-0036 as amended by ADR-0058 makes a crew's sums "over the whole crew", and SPEC's *Consistency* counts the crew's sessions in whichever of its voice channels. A sum names no one, so it cannot open a private channel.
- **L3-13 — refuted.** The rider page shows a status to a viewer the friends panel would not. ADR-0060 and SPEC both list the rider's page as a surface that shows the status, and ADR-0024's "see who before you accept" admits a pending requester to that page. The friends panel is the one place narrower than the name, by design.
- **L10-06** is new evidence for the open #2324 (a comment there), not a new issue.
- **Lens 1's first run** returned an empty findings list: its output was withheld partway through, most likely because it spelled out exploit payloads. It was re-run as two halves (1a, 1b), told to describe each defect as its class, code path, consequence and fix. Everything the first run named in its notes was re-established by 1a/1b or had already been reported by lens 3 or 4.


## Decisions

Three findings failed the decidability test the other way. Nothing in WATTROOM.md, SPEC, an ADR or a rule answers them, because each needs money, taste or risk appetite. They are filed with `needs-human-input` and say an agent must not build them as written:

- **#2818 — signing the desktop self-update (Windows, Linux).** ADR-0037 accepted "Windows ships unsigned" when the shell only nudged a rider to the download page. Its 2026-09-09 amendment made it install updates silently on quit, and never weighed the two together. Anyone who can write a release asset to `natrontech/wattroom-releases` can now run code on every Windows and Linux install. Options: (a) sign Windows and verify AppImage signatures, which costs a certificate; (b) keep the builds unsigned but verify an ed25519 signature over `latest*.yml` against a key compiled into the shell, which costs nothing and covers Linux; (c) turn auto-install off on Windows and Linux; (d) do nothing and record the accepted risk. **Recommended: (b) now, and (a) when ADR-0037's revisit trigger fires.**
- **#2866 — how far image pinning goes.** ADR-0054 exempts the Docker images from commit pinning because the build stages are "builders discarded", but their output is what ships. Options: (a) pin all three images by digest and let Dependabot's docker ecosystem move them, grouped monthly; (b) pin the build stages only; (c) keep the tags and amend the ADR's rationale; (d) do nothing. **Recommended: (a).** Pinning `air@latest` in the Makefile is a plain defect under every option.
- **#2872 — the status line on the riding surface.** ADR-0060 says the status "goes where the rider's name goes, and nowhere else", then lists five surfaces. The code took the first half and draws it on about 24, including the session's crew strip, the sprint takeover and the game panel. Options: (a) call the list illustrative and keep every surface; (b) everywhere except the riding surface, and amend ADR-0060 to say so; (c) back to the five; (d) do nothing. **Recommended: (b).** The riding surface obeys `ux.md` in full (ADR-0020), and a 10 px emoji at three metres competes with the numbers.

One residual judgement sits inside a defect rather than as its own decision. #2837 (the last owner of an empty crew can neither leave nor delete it) is canon-answered and filed as a bug: SPEC frees a founding slot on delete, errors.md names "delete a crew" as a destructive action, and ADR-0038 deletes a crew rather than leave it ownerless. **Whether an owner may delete a crew that still has members** is the one question it leaves open, and the issue says so.

Several findings that read as decisions were answered by canon and filed as defects: the board-enrolment default (#2820, ADR-0058's "nobody wakes up on a board"), DJ credit from a client-reported `ended` (#2834, SPEC's own DJ row) and the SPEC and ADR-0012 drift (bundled).


## The noisiest screens (lens 6)

| Screen | State | Width | Repeated facts | One owner |
| --- | --- | --- | --- | --- |
| /crew/[id]/s/[session] (rider) | mid-ride, 2 joined + 1 member in the channel | 1440 | 9 — the other rider ×6 (sidebar coach line, occupants, voice strip, crew strip, Execution card, people column); yourself ×4; third member ×3; riding bars ×6 glowing; status line ×4-5; session progress ×2 ("0 min" vs "0:12"); rider count ×3 ("· 3", "holding target — 2 / not pedalling — 1", "with you in 2"); target W ×3; execution ×2; not in voice ×3 | Content owns the ride (header, instrument, crew strip); the people column owns identity + execution; voice strip removed on the channel's pages; Execution card folded into the column at ≥1280; sidebar session line reduced to its lit link; people column drops target W; status off the crew tiles |
| /crew/[id]/s/[session] (coach) | mid-ride | 1440 | 9 — as the rider view, plus who coaches ×3 (sidebar "coaching", crown in the people column, the coach toolbar) | Same owners as the rider view; the coach toolbar is the coach's own mark; the sidebar coaching words drop on the session page itself |
| /crew/[id]/s/[session] (rider) | trainer dropout | 1440 | 10 — all of the mid-ride repeats, plus the fault stated once and contradicted three times (glowing stale number, "on target", rider still under "holding target"); the coach's tile keeps watts and bars | The FaultBanner owns the fault; the instrument goes to "—" without glow; the roster and the crew tile mark the rider stale |
| /crew/[id]/v/[channel] | Join voice failed (LiveKit down) | 1440 | 4 — voice failure ×4 (banner, "voice failed", "Try voice again", red box) with 2 recovery buttons and 3 wordings; online members listed "offline"; you ×4 | The banner owns the failure with one button; the you panel keeps at most one quiet retry; the people column stops saying offline |
| /crew/[id]/v/[channel] | session running, member not joined | 1440 | 6 — coach ×3 (sidebar, tile pill, crown); each rider ×3 (occupants, tile, column); a session runs ×4 (sidebar line, Join the ride, "holding target", "is starting" log line); per-rider W ×2 (tile live 72 W vs column target 71 W); sidebar count "· 3" with 2 riding | Tiles own the riders and the coach pill; "Join the ride" owns the running session; the column shows execution not target W; the log line goes past tense; the sidebar count comes from the joined list |
| /crew/[id]/v/[channel]/training | free ride, three in the channel | 1440 | 5 — the others ×3 (occupants, voice strip, people column); counts disagree ("in the channel — 3" vs "with you in 2"); not in voice ×3; Join voice the loudest control | People column owns who is here; the voice strip goes (this is the channel's own page); the you panel's voice block shrinks to the button |
| /crew/[id]/v/[channel] | three on the page, nobody in voice | 1440 | 5 — each rider ×3 (occupants, 400×225 stage tile, column) + a "joined" log line; you ×5; "in the channel" beside "not in voice" | The stage owns the riders (Discord: sidebar + tiles); the column collapses to a heading count or hides while the stage shows everyone |
| /crew/[id]/v/[channel] | channel socket refused | 1440 | 3 — your own presence both online (you-panel dot) and offline (column); a friend online (DM row) and offline (column); "0:00 of riding is buffered" on a page with no ride | The you panel owns your presence; the column says "not here"; the banner drops the riding clause when nothing rides |
| /home | a friend in a voice channel / online | 1440 | 4 — the friend ×2 (Around card + chip below); "Nobody's around" above an online friend; FTP 200 ×2 (set-up input + tile); desktop app ×2 (card + sidebar row, by #1235) | The Around card owns friends in channels; chips only for friends not already named; the empty sentence speaks of channels, not people |
| /crew/[id] | a session running / a rider on a channel page | 1440 | 3 — the session ×2 (sidebar "0 min · 2" vs Live now "2 riding · 0:19"); "in voice" heading for a rider not on the call; crew size ×2 ("3 people", "Members · 3") | Live now owns the session; the heading says "in the channel"; counts from the joined list |
| /crew/[id]/s/[session] | narrow cockpit / phone spectator | 375 | 3 — own watts ×2 (instrument "you" + own tile) with rpm/w/kg ×2; spectator: followed rider's watts and numbers ×2 | The instrument owns the followed rider; your own tile only when the instrument follows someone else; the followed tile keeps its ring and name only |
| /ride | trainer dropout | 1440 | 2 — "reconnecting" ×2 (banner + device line); the stale 86 W glowing "on target" under "signal lost"; wording differs from the session surface | One shared trainer-fault component owns it; the device line keeps the name and the re-pair button |

**Against Discord (ADR-0020).** Discord draws a voice call's people twice: as rows under the channel in the server column, and as tiles in the call view; the right-hand member list belongs to text channels and is hidden in a call. Your own voice state lives in one place, the 'Voice Connected' panel above the user panel, which exists only while you are actually connected, and connection trouble ('RTC Connecting', 'No Route') is said there and nowhere else. 'Offline' in Discord's member list means no client is running. A custom status shows in the member list, the DM list and the profile popout. It never appears on call tiles, on voice-channel participant rows or beside message authors.  WattRoom shows much more. On the session screen at 1440 the same riders are drawn four times: the sidebar occupant rows, the 'with you in' voice strip, the slot-4 crew strip plus the Execution card, and the people column. The coach's line is a fifth. Each rider's status line appears up to five times. One failed Join voice is stated four times with two buttons. The voice strip shows with nobody in voice, because it keys on the channel socket rather than the call. The people column labels online members 'offline', so its presence claims are weaker than Discord's while it takes the same space.  Some of the extra is justified, and each justified part has a written reason: - the riding bars and the session line under a voice channel: ADR-0020's crew radar, the reason to open the app; - live numbers per rider and the execution contest: the product; - a people column that stays up mid-ride: ADR-0020, the roster has to be there without being asked; - persistent full-width fault banners: errors.md, because the rider is three metres away and sweating, while a Discord user is at the desk.  The rest has no reason behind it: - the voice strip on the channel's own Training place and session page (its own comment says it stays off the channel's page); - the Execution card beside the column's execution; - the target watts in the column beside the live tile; - the you panel's 'not in voice', Join voice and privacy promise, where Discord shows nothing until you join; - the status emoji on riding-surface tiles and in the sprint takeover; - the 'offline' group, where Discord would show only 'members' because it cannot say more.

## Checked and found sound

Each lens's own list, verbatim in substance. Every entry is at `ab669885`; a later audit may take it as settled for code that has not moved since.


### Lens 1a — Security — server: authorization and live revocation

- The one entry gate holds: channels/access.go mayEnter (owner/admin enter all, member enters open or named-into private, banned/stranger none) is asked by crewByID, channelFor and door.Authorize, all answering 404-not-403 so a private channel's existence is not leaked; visible_channels view mirrors the same rule for SQL reads.
- Crew role writes (crew_write.go handleSetCrewRole): the owner is never a target, the caller cannot change their own role, a role is refused for a user not already in the crew (stranger admission closed), and a pre-emptive ban of a non-user is a clean 404 — all confirmed against the running app with my own riders.
- WS command authorization (hub/room_ride.go refusalLocked): pause/resume/handoff/sprint/game are coach-only, end additionally allows the crew owner/admin via the live Rider.Role, join/leave/free-ride are any member, and every input channel (cheer, board fire, jukebox, backfill, poke, metrics) is rate-limited on the server.
- Cross-crew isolation: hub methods are keyed by opaque channel id; channels/move.go handleMove refuses a move across crews, refuses a pedalling rider (hub.ErrRiding), and re-asks mayEnter on the destination channel before moving the rider through its door.
- Track audio, board clips and playlist queueing gate correctly: TrackPlayableBy widens playing to anyone sharing a visible_channel with the uploader but keeps browsing uploader-only; board canHear uses hub.WhereIs so a clip is audible only to riders in the same voice channel right now; queueing goes through RequireVoice.
- Calendar feeds (crews calendar.go) exclude plans in private channels and compare the bearer token in constant time; the crew directory and OG image lists disclose only name/mark/link.
- Rider page and friend-request visibility gate on SharesChannelOrFriends/SharesChannel; rides are owner-scoped in SQL (someone else's is 404); crew recaps re-check membership on every read so leaving the crew ends access.
- hub.SetRole re-roles a promoted/demoted rider's open sockets in place, and a crew ban severs the socket and ejects from voice per channel (crew_write.go handleSetCrewRole ban branch).

### Lens 1b — Security — server: auth, outbound fetch, uploads, secrets, ceilings

- SSRF guard (unfurl/guard.go): safeDial resolves, judges every answer with publicIP (v4-mapped, NAT64, 6to4, Teredo, CGNAT, TEST-NETs all covered), dials the checked IP literal so there is no rebind gap, re-checks scheme/host/port on every redirect hop, caps hops/dial/total time, disables keep-alives, and sends no rider-derived header — the same one guarded client is reused by avatars.Mirror so there is no second outbound surface
- gifs proxy (gifs.go): renderable() accepts only https direct-media URLs on media\d*/i.giphy.com ending .gif/.webp, the Giphy key is stripped from *url.Error before logging (#2237), body decode is LimitReader(1MB), and two ceilings (per-account 15/min, shared key 30/hr) ration upstream calls
- og dimension guard (og.go decodePicture, line 314): image.DecodeConfig is checked against maxPicturePixels (4096x4096) before image.Decode allocates, so a small-byte huge-canvas crew picture is dropped rather than decoded — this is the unauthenticated /og/c path
- secrets sealing (secrets.go): AES-256-GCM with a fresh per-Seal nonce, boot refuses a present-but-unusable key (main.go:184) and warns on an absent one, Open distinguishes 'no credential' from 'cannot read', strava/tokens.go refreshToken never reports a bad key as 'no token'
- passkey ceremony hygiene: challenges single-use (take deletes before expiry check), store swept-before-cap at challengeMax=4096, maxPasskeys=10 enforced under WithUserLocked at finish (createPasskeyCapped), credential id via base64url, sign counter written back on every login (passkey.go:367)
- token hygiene (tokens.go): wrt_ + 32 random bytes, SHA-256 at rest, shown once, cap 10 under WithUserLocked, DELETE 404s across accounts, and readSource routes any non-GET to the cookie source so a bearer can never write or cross the CSRF boundary
- the CSRF boundary: RequireUser refuses a mismatched Origin on POST/PUT/PATCH/DELETE (session.go:71), logout and recover check SameOrigin by hand because they must work without a session, and isMutatingMethod is the one gate for ~50 call sites
- export headers (account.go:916): the archive is built whole before the first byte (so a mid-build failure is a 500, not a short 200), Content-Length set, Cache-Control private no-store, X-Content-Type-Options nosniff; served images use ServeImmutableImage/ServeImage with nosniff throughout
- bearer refusals (rides/detail.go:92,212, rides/card.go:34): the per-second record with HR, the .fit and the ride card all refuse a personal token (tokens.Bearer), and the .fit export endpoint is wired to the cookie service not readAuth so no bearer reaches it
- calendar feeds (crews/calendar.go): the crew feed compares the path token in constant time and the crew query drops private-channel plans and the planner name; the rider feed is token-scoped
- dev/synthetic doors: dev login opens only on a local origin (DevLoginMisconfigured boot refusal), the dev callback refuses Sec-Fetch-Site cross-site, synthetic is POST-only bearer with a constant-time compare and a 32-char boot floor, both budgeted
- fitexport (http.go): body capped at 4 MB with DisallowUnknownFields, samples bounded at 21600 and each watts/cadence/HR range-checked, refusal returned as a rider string never err.Error()

### Lens 2 — Security — client, desktop and supply chain

- No {@html} anywhere in web/src (the one hit is a comment in routes/+page.svelte:46); all rider text is Svelte text interpolation. No innerHTML/insertAdjacentHTML sinks outside tests; zwo.ts parses untrusted XML with DOMParser as application/xml.
- parseInline (web/src/lib/chat/inline.ts) emits only http(s) hrefs, so javascript:/data:/mailto: stay inert text (inline.test.ts covers it). Emoji src is built from server ids (crew-emoji.svelte.ts:60-62); StatusMark.svelte renders the status line as text, with src=/api/emoji/{id}.
- Every target=_blank carries rel noopener noreferrer: MessageText.svelte:62-63, LinkPreview.svelte:47-49, PinBoard.svelte:251-253, history/[id]/+page.svelte:321-323 and :456-458; ChatImage.svelte:55 window.open passes noopener,noreferrer.
- Pin link rows open only when isLink() matches ^https?:// (web/src/lib/pins/pins.ts:36).
- Link-preview thumbnails always go through /api/unfurl/image (unfurl.ts proxied()), which serves a type sniffed from the bytes with nosniff and 'default-src none; sandbox' (server/internal/unfurl/unfurl.go:229-254). Inline GIFs only for https allowlisted hosts (media.ts GIF_HOSTS); the IP exposure to GIPHY is decided in ADR-0032.
- og meta splices html.EscapeString over every value including the path, and JSON-LD goes through json.Marshal (server/internal/og/og.go:210-246). The mail-landing pages escape every input and send no-referrer + no-store (server/internal/httpx/page.go; callers in auth/email.go, auth/recover.go, notify/notify.go).
- Security headers on every response via secured(mux) (server/main.go:466, server/headers.go:128-138): enforced CSP with frame-ancestors/base-uri/object-src 'none' and a closed img-src, nosniff, HSTS, a Referrer-Policy and a Permissions-Policy. No CORS headers anywhere in server/. No service worker. /dev/* routes 404 in production builds (web/src/routes/dev/+layout.ts).
- Uploads are sniffed from the bytes against a four-type allowlist and served with nosniff (server/internal/httpx/httpx.go ReadImageUploadUpTo, ServeImage, ServeImmutableImage).
- Session cookie is HttpOnly + SameSite=Lax, with Secure set by the deploy scheme (server/internal/auth/session.go:217-227). The Origin check on mutating methods runs in RequireUser (auth.go:9-14). websocket.Accept with nil options keeps coder/websocket's same-origin check (hub/ws.go:123, hub/lobby.go:83). The dev login refuses cross-site fetches (auth.go:238-245).
- The post-login next= is validated by parsing (web/src/lib/auth/next.ts:15-28, #1610). moved.ts builds redirect targets from server ids only.
- Desktop: contextIsolation, sandbox and no nodeIntegration on both the main and HUD windows (desktop/main.js:260-273, 690-697). Permission request and check handlers decide by the requesting frame's origin (main.js:420-431, #1939). window.open is denied and only http(s) goes to openExternal; will-navigate keeps the renderer on APP_ORIGIN (main.js:496-507). The preload exposes named functions only, never ipcRenderer (desktop/preload.js). The deep link needs the wattroom://auth host, a bounded token and a 10-minute sign-in window (main.js:842-875). Notify and tray hrefs go through ownPath (main.js:766). offline.html writes query params with textContent only. login-item.js takes no renderer input.
- The macOS desktop build is signed and notarized, with a Developer ID + Gatekeeper gate before publish (.github/workflows/desktop-release.yml:156-176, 227-243); the releases repo is live with 2026.9.13.
- Every uses: in .github/workflows is pinned to a 40-hex SHA with a version comment, and ci.yml's docs job enforces it (ci.yml:171-180). There is no pull_request_target or workflow_run. feedback-canary passes secrets through env, never ${{ }} in run. publish.yml and desktop-release.yml declare least-privilege permissions.
- The Dockerfile's final stage is distroless :nonroot, and uid 65532 owns /data (Dockerfile:38-41). pnpm onlyBuiltDependencies limits install scripts to esbuild (web/pnpm-workspace.yaml). pnpm audit --prod (web) and pnpm audit (desktop) report no known vulnerabilities.
- deploy/Caddyfile answers 404 on /metrics*, and docker-compose.prod.yml binds 8080/9091 to 127.0.0.1 only.
- The desktop sign-in nonce is random, shape-checked and single-use (web/src/lib/desktop.ts:320-380); the release feed hrefs come from api.github.com's browser_download_url.

### Lens 3 — Privacy and data lifecycle

- The one gate: channels/door.go:25-78 Authorize asks mayEnter for both the channel socket and the AV token. A member refused by a private channel got 403 on av-token and the channel dropped out of their list (privatise.mjs). The visible_channels view (migrations/20260922203908) states mayEnter word for word.
- Ban and leave sever live sockets: crews/crew_write.go:193-205 evicts from every voice channel and sweeps channel_members; crew_join.go:196-234 does both in one transaction and evicts after commit; channels/members.go:53-80 evicts on unname unless the crew role still admits the rider.
- Friends panel (friends.go:120-200): presence and status only for accepted friends; the channel is named only through channels.PlacesFor → VoiceChannelsVisibleTo; Riding is a boolean that names no channel.
- Rider page (riders.go): the SharesChannelOrFriends gate covers the page and the avatar, with the same 404 text; shared rides, month totals and online state go only to self or friends; a crew-mate learns presence only for a channel they may enter.
- ADR-0055: ListSharedRides names its columns (no note or RPE); GetRide is owner-scoped; the card, detail and .fit refuse a bearer; note and RPE appear in neither fitexport, strava nor og/ride.
- Bearer tokens (ADR-0017): only progression, rides, gamify mine and mcp are built with readAuth (main.go:268-345); the progression payload carries no HR field.
- DM heads join an accepted friendship (dms.sql:182-226); a DM image is readable only by its own pair; the read cursor pings only the reader's own lobby sockets (hub/lobby.go:154-163).
- Calendar: the crew feed leaves out plans in private channels and planner names (schedule.sql:182-201); the rider feed resolves membership on read and excludes banned riders (schedule.sql:203-222); both send Cache-Control private, no-store.
- Session mail targets (ListCrewNotifyTargets): verified addresses only, the channel's gate, the actor excluded, and decliners left out of the reminder; the audience is read before a private channel is deleted (#2610).
- Recaps: ListCrewRecaps applies the channel gate and the 90-day bound in SQL; ExportUserRecaps narrows to the rider's own interval; housekeeping prunes in batches; a channel delete cascades its recaps.
- Uploaded audio: board clips use a live canHear, same room now (board/board.go:359-369); pool tracks play only through visible_channels (tracks.sql TrackPlayableBy).
- Directory and door: the directory gives name, icon and link only (crew_directory.go); the door discloses boardEnabled and nothing past it; the og card for /c/{code} is name and picture only and is throttled.
- Tick addressing: pairing answers, pokes and the rider's own IP (OwnConnection) go to their one socket only (hub/tick.go:292-303, ws.go:141-148).
- Account purge: every FK to users was enumerated from the dev DB; everything cascades except crews.owner_id (RESTRICT, handled by ReleaseCrews) and the SET NULLs track_plays.queued_by, crews.founded_by, crew_pins.created_by and channel_members.added_by (the pins one is by ADR-0056); the users_purge_recaps trigger exists; Strava is revoked after the delete; orphaned audio blobs are reaped.
- DeleteRide (rides.sql:94-114) keeps the XP in the same statement (ADR-0047); medals cascade with the ride.
- The in-app Strava disconnect revokes upstream first, then forgets remote_id and deletes the identity in one transaction (credentials.go:112-145).
- The feedback public issue: no reporter name, the route redacted by allowlist, HR fields dropped from the typed buffer, rider text fenced.
- The export zip is built whole in memory, sent with Cache-Control private, no-store, and carries a manifest; avatar and clip bytes are included (ADR-0053); tokens and hashes are never exported.
- The Prometheus metrics port uses only job/outcome labels, so no rider or crew ids are exposed there.

### Lens 4 — Live state and server correctness

- web/src/lib/protocol.ts is in sync: `go tool tygo generate` into a scratch copy of the server produced a byte-identical file.
- `go vet` is clean on hub, protocol, stats, workout, notify, recap and gamify. `go test -race` is green on internal/hub (66 s), internal/protocol and internal/workout, run in a scratch copy.
- Hub lock order: h.mu is never held while taking a room lock. Presence, WhereIs, Riding, ridingCount, SetProfile and PokeRider copy the room refs and unlock first, and voiceChangedLocked defers setVoice until after h.mu is released. The tick releases rm.mu before any I/O, marshal or keeper call, and the `locked` flag's defer unlocks on a panic (tick.go:53-58).
- Every hub goroutine has an exit. The socket writer exits on done, a failed write or an unanswered ping. The lobby writer exits the same way. room.run exits on stop or a forget. Detached saves, amends and recaps are bounded by their retry policy and counted by Drain. The autoplay worker lives as long as the process (ponytail noted).
- Queues are bounded and drop rather than block: the client out queue (8), the lobby ping (1, coalesced), autoplays (64) and gamify jobs (256). h.sockets and h.holds delete their keys at zero (releaseCount). There are at most 16 sockets per rider and 512 KiB per frame. Backfill is at most 3600 samples per batch, once a second. A rider's record holds at most 6 h. Cheers and board are capped at 32 per tick, events at 64.
- WS input is bounds-checked before it touches state: watts 0–3000, HR 0–250, cadence 0–250 (room_ride.go:17-21). Metrics are limited to 10/s per rider, cheer and board to 1/s, jukebox to one per 300 ms, and pokes by a cooldown per target. checkPick checks the name, the JSON size, workout.Validate and Parse. Device kind and away reason come from closed sets. The sensor tab and device strings are clipped.
- The idle sweep (#2297) is correct: holdRoom encloses a socket's membership, forgetRoom re-checks the rooms map, holds and h.voice under h.mu, and synctest tests cover it.
- Session lifecycle numbers match SPEC: a 10 s countdown, and stopping during the countdown resets the session (#2605). There is one session per channel, with a conflict refusal that names the coach. Refusal codes stay inside errors.md's closed set, and the jukebox_ prefix is a routing prefix only.
- ADR-0059 filtering holds in setMetrics, backfill, sprint collection, game samples and the tick's Execution map. A spectator who is pedalling still reads as riding. Live numbers reach the channel's sockets only.
- The tick's OwnConnection (IP) goes only to the socket's own rider (ws.go:146-148). The riding gauge carries no channel label. LiveSession and Presence carry only presence-class facts, never a number.
- Stats constants match docs/SPEC.md. Band is ±5 % with a 10 W floor (protocol.TargetBand). XP is 1 kJ = 1 XP plus execution × 50. The streak bonus is 25 × weeks, capped at 250. Categories are D &lt; 2.5 / C / B / A ≥ 4.0. The FTP suggestion is 0.95 × best 20 min when that exceeds FTP by > 2 %. The LTHR suggestion reads the last 20 minutes and needs readings for at least half of it. NormPower uses a 30 s window, 4th power and the 20-min fallback. Load is I² × h × 100. Fitness/Fatigue are 42/7-day EWMAs with Form taken from yesterday's values. The five form zones, the SuggestToday rule order with its why-clauses, the 28-day cold start and the Coggan zone tops all match.
- Gamify constants match SPEC. Lounge: 1 XP per 5 min, capped at 24 per UTC day, keyed per minute so it is idempotent. Session voice bonus: 5 XP, ≥ 2 saved rides, ≥ 10 min, voice for ≥ half. Crew Chief needs ≥ 3 saved rides. Achievements pay 100/250/500. Thresholds are 45 min ≥ FTP, 3 min ≥ 121 %, espresso &lt; 25 min with ≥ 80 % > 94 %, before 07:00 and ≥ 23:00 or past midnight in the rider's zone, 200 rides, 600 voice minutes, 50 tracks and 10 sprint wins with ≥ 2 riders.
- BPM-matching effort tiers (80/85/90/95 rpm) and the cadence-band midpoint match docs/SPEC.md:568.
- Migrations follow expand/contract. drop_rooms (.129) shipped after .128's generated SQL stopped naming rooms or room_id. drop_crews_cheers (.144) shipped after .143 stopped naming the column. Every migration since #928 has a timestamp name with no duplicate prefix, goose runs WithAllowMissing, and nothing is due a contract except #1038 (open).
- Background jobs survive a restart. Housekeeping runs at boot and daily, with a 5-min budget per sweep and batched deletes. Message expiry runs every minute. Reminders claim first, then mail with a budget per session. The voice clock has a budget per tick. The recap write is an upsert keyed on the session id, with retry. The session saver retries 8 times and is idempotent through FindRideAt, and Drain(150 s) covers its retries. ADR-0052 rule 4 holds: an orphaned record is never saved.

### Lens 5 — Rider journeys

- (a) Signed-out landing → 'Start your crew' → /login → Dev sign-in as a new rider lands on /home, with the new-account notice naming the provider and pointing to Settings → Profile, where ProviderConnections lives (a1)
- (a) Home's Start a crew sheet founds l5-crew and lands on /crew/{id}, which opens with a chat and a voice channel. The crew page teaches the first step ('Go to Lounge') and shows the invite (a2)
- (a) First voice channel → Free ride → Ride simulated → End ride saves the ride and links to Rides; FirstRun then counts the ride (a3)
- (b) A signed-out invite: /c/{code} → /login?next=%2Fc%2F… names the crew ('You are invited to l5-crew'), and sign-in comes back to the door (b1)
- (b) An existing member at the door gets 'You are in this crew with 1 other · Open l5-crew'. A banned rider at the door gets 'This crew removed you', and by id gets 'No crew lives here' with Home (b1, b2)
- (b) The door for a crew with the board on names the board and the per-rider switch above the Join button (b2)
- (b) '/' for an invited rider who has not joined routes back to the door through me.pendingInvite (b3)
- (c) Plan → RSVP from the crew page → the Schedule shows '1 in — Lfive Ben · 1 unanswered' → Start now puts the coach on /crew/{id}/s/{session} in the count-in (#2599 holds). End asks with the rider count. The summary moves the coach back to /v/{channel} (#2600 holds) and 'See your ride' reaches /history/{id} (#2631 holds) (c1, c3)
- (c) All 41 issues filed by the 2026-09-24 ride-flows audit are closed; spot-checked in code: delete-ride copy says XP stays (lib/ride/delete-ride.ts:23), 'Start without a trainer' in PlanCard and SessionPicker
- (d) Reloading 75 s into a free ride: the ride is offered back on the crew page ('A ride never reached your account … Open Rides') and on /history ('Recovered an unfinished ride — Free ride … Save / Download .fit / Discard') (d1)
- (e) .zwo import: the preview says what the file could not bring, the save lands on the shelf, and the workout appears under YOURS in the crew Schedule's picker (e1)
- (f) Friend code → request → the other side sees it live without a reload → Accept → online presence → DM delivered and in the peer's sidebar. A DM with a non-friend crew-mate is locked, with an explanation (f1, f2)
- (g) /settings redirects to profile and all six sections render. Export downloads a 28-file zip whose profile.json carries the status and whose samples are included. Delete account needs DELETE typed, signs out to the landing, and hands the crew to the longest-standing member (g1, g2)
- (g) Disconnecting the last credential is refused server-side with an actionable sentence (server/internal/auth/credentials.go:108)
- (h) /login?desktop=&lt;nonce>: a fresh sign-in comes back through the stash to /login?desktop and mints the wattroom:// link. /hud's quiet and signed-out states render (h2)
- Legacy links: /r/{slug}/…, /messages/r/{slug}, /rooms, /sessions, /progression and /dm/{peer} all redirect (web/src/lib/moved.ts, routes/*/+page.ts)
- Lead 8 (/ride lights Workouts in the sidebar) is by design: the 2026-09-10 navigation audit records `covers` keeping Workouts lit under /ride and /ramp

### Lens 6 — Information density and status redundancy

- ChannelStatus.svelte:47-170 ranks channel-level status and draws one banner at a time (connection > guard > spiral > trainer > voice > mic); no two stacked in any l6 drive (dropout, offline, voice failed).
- Solo /ride mid-ride (capture state-mid-ride-1440-dark-cleo): one header, one glowing number, no roster or voice strip — the quietest riding screen; the model the session screen should converge on.
- HUD (capture state-hud-data-320x180-dark-cleo, routes/hud/+page.svelte:68): workout, watts, target, time left, one each; only the watts glow.
- Count-in (capture state-count-in-coach-1440-dark-ana): one digit, workout name, "1 rider", one Stop button.
- Ride-critical faults stay persistent banners on both riding surfaces (FaultBanner via ChannelStatus, RideStatus solo) and never toasts — canon held; only the duplicates were flagged.
- YouPanel does not repeat Away (#807): the avatar mark plus the button's face (YouPanel.svelte:166-168, 318-330).
- Friends status line is gated server-side to accepted friends (server/internal/friends/friends.go:152-155); Cleo's pending request row carries none (capture route-friends-1440-dark).
- StatusMark hides an expired line client-side (StatusMark.svelte:21-26) and positions its sr-only words (#2735).
- Glow sweep over 30 driven screens (scratchpad/l6/report*.json): no --color-neon element glowed; tileFrame is asserted glow-free (presence-marks.test.ts:14-27).
- Unread counts live only in the sidebar rows (CrewColumn.svelte:196-198), not repeated on the text channel page (capture route-crew-id-c-channel-1440-dark).
- Training.svelte:259-264 and :316-321 refuse a second full-width list of riders during a sprint or a game inside the content column.
- AroundNow.svelte:39-45 shows a skeleton while the live read is out rather than "nobody's around" (#1666).
- The voice page's plan card and the organiser's RSVP breakdown ("Show names") state the plan once per screen (l6 shots/friend-request-voice-ana.png).

### Lens 7 — UX rules conformance

- Focus rules: the composer (textarea role=combobox) takes focus on a direct load of a chat channel, on sidebar navigation between two chat channels, and when coming from the crew home. Tested live in l7-crew (scratchpad/l7/focus.mjs).
- Error-with-retry on every crew place, /u/[id], /history/[id], /friends, /crews/directory, /settings/profile passkeys and /settings/data (coach tokens, calendar link) when /api answers 500 (scratchpad/l7/sweep.mjs error). /workouts keeps 'a shelf that could not be read is not an empty shelf' (routes/workouts/+page.svelte:158-168).
- Client-fetched pages draw skeletons while slow: /music, /friends ('Loading friends…'), the pins board (lib/pins/CrewPins.svelte:84-88), the thread log (lib/messages/MessageThread.svelte:282-284).
- Capability gating on a phone: /ride 'Start the ride' and /ramp 'Start ramp test' render [disabled] with 'This device can't reach a trainer' (captures route-ride-375-dark.aria.yml:62, route-ramp-375-dark.aria.yml:53). A phone spectator on a voice channel is offered only 'Plan for later', with no Start/Free ride (state-voice-two-riders-375-dark-cleo-phone). The desktop Training place without Web Bluetooth says 'needs chrome or edge'.
- The founding cap is gated before the click: StartOrJoin.svelte:70 (foundedOut against protocol MaxFoundedCrews).
- The irreversible-action inventory web/src/lib/irreversible.test.ts covers 20+ actions (ride delete, channel delete, ban, hand-over, calendar/invite resets, passkey, provider disconnect, coach token, clip, track, recovery address, account). Every confirm's action button names the act (grep of confirm() call sites).
- Undo toasts exist for workout delete (routes/workouts/+page.svelte:48-56), unpin (lib/pins/PinBoard.svelte:89-98), announcement take-down (lib/announce/take-down.ts), queue removal and skip-rest (Jukebox.svelte:66, JukeboxDeck.svelte:98), a playlist track removal, share toggles and friend-request dismissal (/restore).
- Context menus attach on 30 components (sidebar channels, rider tiles, stage, queue tracks, messages, DM heads, members, rides, workouts, library tracks, pins, plans). The message row and the members row also have a visible '…' opener (lib/messages/LineActions.svelte:69-73, routes/crew/[id]/members/CrewPeople.svelte:203-214). Destructive entries sit last after a separator (person-menu.ts:183-190).
- Empty states teach with a CTA: crew Board ('Pin something'), Schedule ('Plan the first session'), crew Workouts, an empty chat channel, Rides, Workouts, Music, Friends, Messages, the directory, own rider page (captures state-empty-* and scratchpad/l7/empties.mjs).
- Mid-ride controls on /ride are btn-lg (RidingScreen.svelte:108-126). Free ride End/Grade/Watts/± measured 44–46 px. SessionControls' non-compact row is min-h-11, and End on /ride asks (#2623).
- WS refusal codes stay inside errors.md's closed set: 129 not_found, 116 validation_error, 80 invalid_request, 33 forbidden, 30 rate_limited, 15 conflict, 9 unauthorized, 2 internal_error, plus the jukebox_ routing prefix. A refused command shows as a 6 s persistent warn banner (lib/channel/live.svelte.ts:368-381, ChannelStatus.svelte:222-228).
- Vocabulary in web copy: no 'room' in any rider-facing web string. The one mention (crew settings calendar notice, routes/crew/[id]/settings/+page.svelte:383) is a deliberate migration note. 'Chat channel' is used consistently (SPEC glossary #2696), with no rider-facing 'text channel'. Music says Library and never pool or shelf. 'Shelf' appears only for workouts, as the Workout glossary entry has it.
- No generic 'Something went wrong'/'Oops' copy in web or server. The root +error.svelte says what, why and what to do, with Reload and Home.
- Field errors sit inline under the field on the friend-code box (lib/friends/FriendsPanel.svelte:188-189), and background acts' refusals go to a toast (FriendsPanel.svelte:70-73).

### Lens 8 — Visual system, accessibility, phone width

- Phone width, measured on a real phone context (375×812, isMobile, touch, Web Bluetooth removed) in dark and light: page-body/place-body excess is 0 on every routes.ts MEASURED route, every MEASURED_BY_ID route, the voice channel, its /training place, /hud (no page-body) and the running session page. The only exception is /messages/dm/[peer] (L8-03).
- A 100-character status line with emoji measured 0 excess on /u/[id], /friends, /messages, /crew/[id], /members, the text channel, the voice channel, /home and /settings/profile, both as the friend and as the rider wearing it.
- Signed-out pages at 375 in both schemes (/, /login, /login/recover, /c/[code], /terms, /download): the document never overflows.
- Tap targets at 375 on 31 signed-in routes, with the WCAG 2.5.8 spacing exception applied properly: no conforming failure. Sub-24 px targets are inline text links, or widely spaced standalone btn-links and summaries.
- Mid-ride targets: every control inside .cave on solo /ride (+1 min, Skip block, TV, End ride, flag, bias ±) is ≥ 44 px at 1440 and in a 375 window. So are the session's coach controls (sprint, pause, crown, stop), TV, Leave the ride and bias ±. The one exception is Unpair (L8-12).
- Icon-only controls: a static scan of every .svelte outside /dev found no button or link without text, aria-label or title. The runtime probe found 0 unnamed controls on 37 routes, the session and /ride.
- The phone drawer (routes/+layout.svelte:400-421): Enter opens it with focus on the first row, Tab stays inside, Escape closes it and returns focus to 'open navigation'.
- The confirm dialog (ConfirmHost.svelte / Modal.svelte / focus-trap.ts) opens on the safe answer ('Keep it'), and Tab wraps inside it.
- ADR-0005: nothing applies glow-* to neon outside /dev. The glow utilities resolve to transparent in the light family (app.css:94-126). .cave keeps the ride dark with the OS in light mode (capture state-mid-session-1440-light-ana).
- The theme gate holds for the text ramp. Across a runtime contrast sweep of 10 routes in all 10 themes (5 identities × dark/white), no ink, muted or muted-dim text fell under 4.5:1 unless faded by opacity (L8-09) or coloured with an accent or zone token (L8-01, L8-05).
- Reduced motion is honoured by the skeleton (app.css:340-344), RidingBars, Logo, ClayRider, CheerLayer, LandingHero, UpdateRow, VoiceOccupants and every motion-safe:animate-pulse dot. No smooth-scroll calls exist.
- Live regions: Banner is role=alert/status by tone (Banner.svelte:28), RideStatus uses it for signal loss, CountdownScreen and SprintMoment carry sr-only role=status, MessageThread is role=log and Toasts are aria-live.
- The document declares lang=en, and the viewport meta leaves zoom enabled (app.html:2,5).
- routes.ts exclusions re-checked. /dev/* 404s outside dev (dev/+layout.ts). /settings, /progression, /sessions, /rooms, /dm/[peer], /messages/r/[slug] and /r/[slug]/[...place] all redirect as stated. hud.spec.ts:17 asserts there is no page-body. /crew/[id]/v/* is measured on the Pixel 5 project (playwright.config.ts:100-101, mobile-channel.spec.ts:110-160). /crew/[id]/s/* is the exception (L8-14).
- Context menus return focus to the opener, or to the anchor made focusable (context-menu.svelte.ts:77-100). Reorder-by-drag surfaces offer Move up/down in their menus (StepList, ChannelRow, JukeboxTrack, JukeboxPlaylistRow).

### Lens 9 — Code health, consolidation, doc drift

- The one permitted full `make test` ran from the review worktree at ab669885 and is green. Every Go package passed under -race -shuffle=on against wattroom_test_wt_full_review_49d0, and vitest passed 219 files and 1915 tests. The only noise was two svelte state_referenced_locally warnings in web/src/lib/sound/mixer.svelte.ts:91-92, which are intentional initial reads, and an eager-shell warning under vitest only. The production build has 6 modulepreloads.
- ADR-0058 contract timing honours ADR-0019. 21a38749 (stop reading and writing the room tables) first shipped in 2026.09.128, and 6d7bc249 (drop the rooms) in 2026.09.129. The .128 image's generated SQL mentions room_id only in comments, so a retag to it is safe. crews.cheers followed the same pattern: code stopped reading it in .138, #2784 made the sqlc lists explicit in .143, and the drop landed in .144 (3d85a355).
- Every Up migration since 20260922 only drops what those two contracts name. 20260922191537_jukebox_channel.sql widens playlists_one_owner before #2433 tightens it.
- The live schema has no room-shaped column left except moved_rooms, which is deliberate for the /r/{slug} redirect.
- All 320 sqlc queries have a production caller, and all 289 base-table columns are named by at least one query.
- web/src/lib has no unimported module or component, and there is no commented-out code in server/, web/src or desktop/. The only console.debug (web/src/lib/sound/cues.ts:146) is deliberate.
- Protocol: 217 JSON fields in protocol.go and status.go. Go writes all of them and the web reads all but ChannelPresence's cameras, ridingIds and awayIds, which channels/sidebar.go folds server-side. No room-shaped protocol field remains, and ChatLine, ChatEdit and ChatReactionCount are HTTP shapes, not socket traffic.
- Trainer seam: nothing outside web/src/lib/ble touches GATT. The only navigator.bluetooth uses are capability checks.
- errors.md closed set: every httpx.WriteError, WriteFieldError and hub writeError code is one of not_found, validation_error, invalid_request, forbidden, rate_limited, conflict, unauthorized or internal_error. No err.Error() reaches a response body.
- mayEnter is the one Go gate, called from channels/access.go, door.go, live.go, move.go and members.go. The hub asks through the door and never sees a crew beyond the role the door hands it.
- SPEC numbers match the code for: ride guards (5 rpm, 20 W, 3 s, 3 s, 600 s, 50 rpm, 5 s, 0.5, 10 s); the ramp (100 W, +20 W per 60 s, 25 steps, 0.75, 0.75 for 5 s, 300 s warm-up, 2 steps); Backyard, Collective, Golf, Lava and Relay parameters; sprint 15 s, klaxon 3 s, 250 ms burst; 30 s disconnect grace; medals minimum 3; recaps 90 days; lounge cap 24; achievements 100/250/500; 100 plans; 30-day calendar history; gate 0.02, 1200 ms, 5/150 ms; speaking 400 ms; ducking 0.25, 150/600/400 ms; SIGNAL_LOST_MS 3000; INTENT_TTL_MS 10 s; REJOIN 60 s and 20 s; SILENCE_MS 5 s; backoff min(1000×2^n, 10 s); IN_SYNC 0.6 s; level 500×n^1.6; NP floor 20 min; execution bonus ×50; tolerance band via protocol.TargetBandFraction and TargetBandFloorWatts.
- Every `make &lt;target>` named in AGENTS.md, CONTRIBUTING.md, README.md, docs/*.md, .claude/rules and .claude/skills exists in the Makefile.
- "Chat channel" in rider copy is sanctioned by the SPEC glossary (#2696); it is not vocabulary drift.
- A sweep of web/src string literals and markup found no rider-visible "room". The remaining leftovers are server-side (L9-04) or identifiers and comments (L9-09).
- The e2e and unit assertion scan found no vacuous assertion. phone-width.spec.ts:431's toBeGreaterThanOrEqual(0) is a real indexOf check.
- ARCHITECTURE seam 3: a ride's stats save in one transaction (server/internal/stats/saver.go:79-157).
- Signed-out 401 coverage exists for friends (friends_test.go:569-590), status, emoji, chat, dms, board, channels, twelve crew routes (crews/boundary_audit_test.go), members, the directory, founding, the RSVP and the schedule GET.
- ListCrewRecaps' hand-restated gate has a private-channel test (crews/crew_members_test.go:138-160), and ListCrewsInCommon has its ban case in riders/riders_test.go:394-418.

### Lens 10 — Performance and endurance

- Hub tick loop: one marshal per room per tick (tick.go:255-293), a writer goroutine per socket with an 8-frame queue (ws.go:31, 375-407). Measured server CPU for 8 WS riders plus a full jukebox was 0.04 CPU-s over 20 s, about 110 KB allocated per tick process-wide, and heap back to 3.7–6.9 MB after five runs of 3–7 min
- Server ride accumulator is bounded: 6 h per rider, deduped by (stream, seq), one sample per timeline second (accumulator.go:17-18, 76-120). About 1.4 MB per rider at the cap
- Client IndexedDB ride ring is bounded: KEEP_RIDES=5 pruned on every open, one row per second, one transaction per append (ride/buffer.ts:50-52, 156-176, 234-265)
- Session page memory over a 6-minute ride with 9 riders (scratchpad/l10/client-quiet-long.log): JS heap 15.9 → 15.65 MB after forced GC, 4,827 DOM nodes and 474 listeners steady. Heap snapshot: 0 detached DOM nodes in the app's isolate
- Other client ring buffers are capped: channelEvents at 100 (live.svelte.ts:61-70), flight recorder at a 120 s window, 100 events and 20 errors (flightrecorder.svelte.ts:12-15), pending WS commands at 16 (live.svelte.ts:403)
- #1710 holds: WorkoutJSON is stripped from the shared tick and sent per socket only on a new hash (tick.go:261-293, live.svelte.ts:342-356)
- The 4 Hz timers are gated to sprint windows (Training.svelte:62-66, SprintMoment.svelte:36-40, ride-sounds.svelte.ts:121-126, ride.svelte.ts:227-231), and the server burst is bounded by tickIntervalLocked (tick.go:516-529)
- Bundle: LiveKit (chunks/BDqg5Avu.js, 556 KB) loads only on voice join, and emojibase data (chunks/CelYNJqw.js, 571 KB) only when the picker opens (emoji/data.ts:54-55). The eager shell is 137 KB + 271 KB raw (~46 + 94 KB gz) plus 104 KB CSS (17 KB gz). The largest route node is 27.5 KB
- Static delivery: /_app/immutable/* served gzip with 'public, max-age=31536000, immutable'; index.html is no-cache with an ETag (curl against :8228)
- EXPLAIN (GENERIC_PLAN) sweep of all 320 sqlc queries with seqscan disabled: only 17 have no usable index. The other per-ping reads (UnreadByChannel, LastLineByChannel, crew channels, members, friends, schedule) are index-served
- No database write per request for auth sessions (auth.sql has no touch or extend query)
- Power curve is computed once at save (stats/saver.go:126) and aggregated from stored bests (rides.sql CurveBests), never by re-reading sample blobs

## Not checked

What the fleet as a whole could not reach, and why, then each lens's own list:

- **Voice end to end.** LiveKit could not start on the review host (the Windows host reserves UDP 51000–51050), so nobody was ever "in voice". Voice was reviewed from the code, and as the app's LiveKit-unavailable state, which is where #2850 came from. Ejection from a call (#2807) was read, not run.
- **Real OAuth providers, real passkey ceremonies, real mail.** Only the dev provider exists on a dev box, and no mailer was configured.
- **Real hardware.** Headless Chromium has no Web Bluetooth, so every riding state used the simulated trainer, and the desktop sensor cards read "Needs Chrome or Edge" in the captures.
- **Emoji rendering.** The host has no emoji font, so emoji are tofu in the PNGs. The `.txt` files beside them carry the real characters, and lens 6 counted from those.
- **Production and the homelab** were out of scope by design.


### Lens 1a — Security — server: authorization and live revocation

- Behaviour under a real OAuth provider and a real passkey ceremony — covered by the 2026-09-08/09/10 auth audits and out of the live-server scope here.
- Whether av.Eject and the voice reconciler actually remove a LiveKit participant — LiveKit is down on this host, so those paths were read from code only, not exercised.
- The tick's n-in-1-out fan-out internals, game-mode scoring and per-rider execution retention — lens 4/10 ground, only skimmed for the authorization surface.
- Exhaustive per-endpoint request-body bounds validation — relied on the 2026-09-17 server-api audit's verdict rather than re-deriving each handler.
- Crew-level deletion / last-channel deletion paths — there is no delete-crew endpoint by design (ADR-0058), and the succession/decision angle is L9-03's, not re-verified here.

### Lens 1b — Security — server: auth, outbound fetch, uploads, secrets, ceilings

- The OAuth flow against a real Google/GitHub/Strava provider — read only, and only the dev provider is configured on this host, so no callback was driven end to end (still true from the 2026-09-08 audit)
- The LiveKit av-token grant and webhook HMAC — out of this half's slice (av package), covered by earlier server-api audits; LiveKit is down on this host so nothing could be exercised
- The desktop shell's own half of the handoff (wattroom:// registration, native window) — client/Electron side, out of the server slice
- How the notify mails actually render, and the budget window semantics under a live clock — read the code, did not drive a mailer (none configured here)
- Whether the account-export ZIP is genuinely bounded for a rider at the 100 MB clip ceiling under real load — reasoned from ADR-0053 and the one-clip-at-a-time loop, not measured with a full board

### Lens 2 — Security — client, desktop and supply chain

- deploy/.env.example: a deny rule in this environment blocked reading it, so the self-hosting defaults it documents (WATTROOM_TOKEN_KEY, WATTROOM_DEV_LOGIN, secrets) were not reviewed.
- Server-side outbound fetch safety (SSRF and private-address guards in internal/unfurl, internal/gifs, the avatars copy at sign-in, og): only the response headers were read. Left to the server-security lens.
- Server auth internals beyond the cookie/CSRF/WS-origin surface: OAuth state, passkey ceremonies, personal tokens and MCP (ADR-0017), recovery-link spending, desktop redeem server side, and WATTROOM_TOKEN_KEY sealing.
- The desktop shell was not run (no Electron display or built shell here). The will-redirect behaviour, the Settings dead-ends and the passkey hang (L2-06) are from code plus ADR-0040's own record. Windows and Linux installers were not executed.
- deploy/ was not run: docker compose by hand is forbidden, so L2-07 rests on Docker's host-vs-bridge network semantics rather than a live stack.
- The homelab repo (janlauber/homelab) was not read, so whether a forged GHCR tag or GitHub Release would be rolled out (L2-03's last step) is unverified; the 2026-09-10 agent-factory audit flagged the same unknown.
- Voice rejoin across accounts on a shared browser (wattroom.voice.rejoin.v1, 60 s window, web/src/lib/channel/rejoin.ts) could not be exercised with LiveKit down, and was judged too narrow to report from code alone.
- The capture set was not used; the lens was code-first. The two reproductions ran against the dev app on :5628 as riders 'Lens Two Ana' and 'Lens Two Ben' (dev names admit only letters and spaces, so the l2- prefix could not be used), with crew text channel 'l2-links'. Ben's LTHR was reset to 0 and the fake IndexedDB ride deleted afterwards; Ana keeps LTHR 171 and the l2-links channel with one message.

### Lens 3 — Privacy and data lifecycle

- Voice/LiveKit (down on this host): the AV token path beyond its 403, the webhook's voice/camera presence names, Eject on ban. Every eviction probe exercised the metrics socket only.
- Live Strava revoke/upload and live mail delivery: code read only; no provider was connected or configured.
- The web rendering of every surface against the capture set: this lens was code-first, and the capture set was not consulted.
- The migration rollback safety of M9's room-table drop. The rooms tables are already gone from the dev DB (drop_rooms migration), which ADR-0058/0019 said would wait a release. This belongs to the migrations lens.
- Unfurl/GIF proxy outbound privacy (rider IP and referrer), and the desktop shell's storage.
- MCP over a real client; the gamify rider trophies route beyond the prior audit's verdict.
- Probe side effects in the dev DB (wattroom_wt_full_review_49d0). The dev ?as= regex rejects digits and hyphens, so the first run's 'l3-owner'/'l3-mem' fell back to the shared 'Dev Rider', which now owns a crew named 'l3-crew' (its voice channel was toggled private and restored open). Every later probe used 'Lthree *' riders and crew 'l3-crew-a'. The accounts 'Lthree Gone', 'Lthree Erased' and 'Lthree Ana' were deleted; 'Lthree Ben' now holds a ride recovered from Ana's device buffer; l3-crew-a's board was switched on and back off, and its channels restored to open.

### Lens 4 — Live state and server correctness

- Jukebox internals (queue caps, votes, playlist entries, sync anchors): read only as far as the XP hook (onEnded) and the autoplay worker. They belong to the jukebox lens.
- LiveKit webhooks, tokens and ejection (internal/av): LiveKit is down on this host, so VoiceJoined/VoiceSync were only read, never exercised.
- DB-backed tests (stats saver/amend, notify, gamify, store invariants): not run, since the brief forbids a full make test. My repros ran as pure unit tests in a scratch copy of the server module at scratchpad/l4/server.
- sqlc-generated code freshness: regenerating needs the pinned sqlc download, so it was skipped.
- Watt Golf, Floor is Lava life and zone rules, and the relay distance maths, beyond the elimination-order and withdraw checks.
- Callers of presence and privacy views (friends.go and riders.go use of WhereIs/Riding, sidebar occupants): left to the privacy lens.
- Client crash recovery (web/src/lib/ride/buffer.ts, /ride recovery card) beyond reading the order in which live.svelte.ts sends its backfill.
- The Strava delivery worker and FIT import.
- Harness note for the orchestrator: the dev door's ?as= accepts letters and spaces only (server/internal/auth/auth.go:199). Names like 'l5-ana' fall back silently to the shared 'Dev Rider', and other lenses' crews (l3-crew, l9-crew, vl2-04-crew) have landed on that one account. My own live repro used riders 'Lfour Owner' and 'Lfour Member' and created crew 'Lfour crew' with voice channel 'Lfour voice' in the dev DB.

### Lens 5 — Rider journeys

- Email verification and account recovery end to end: with no WATTROOM_RESEND_KEY in dev, notify.New returns nil and mailAvailable is false (server/main.go:249-262), so the gate, the mailed link and /login/recover were read from code only. There is no dev mail sink to walk them locally
- Real OAuth providers: only dev is configured. The consent-cancel path (L5-10) is inferred from code plus a curl on the dev callback
- Synthetic-provider panic in production (L5-03): read from code. Only the dev twin was reproduced
- Anything LiveKit: it is down. Join voice being enabled while LiveKit is unreachable (lead 6) is left to the voice lens. One sidebar voice-channel click in h1 attempted a voice join, which failed ('voice failed'); nothing was published
- The desktop shell itself: only window.wattroom was emulated. The HUD window's open/close IPC and notification-click routing were not exercised
- /ramp ridden end to end (12–18 min) and a solo /ride crash-reload: relied on the ride-flows audit and the fixes merged since 705acbd9
- Privacy of live numbers shown to channel viewers who are not in the call (lead 5), and a warm-up in the Lounge showing live tiles without a free ride armed (RiderTile live = rider.riding): left to the privacy lens
- Recap counting phone spectators (lead 4) and the trainer-dropout instrument keeping the last watts under the banner (lead 7): outside this lens's brief for (c)/(d)
- Sharing a ride and a friend seeing it on /u/[id], and the workout editor built from scratch: not re-walked, since prior audits recorded them sound
- Phone-width runs of my own journeys: I relied on the capture set's 375 px shots
- Leftover state: l5 riders (Lfive Ana, Ben, Cleo, Eve, Fay), l5-crew (board on, a started plan, voice channel l5-spin) and l5-dan-crew (now Ben's, which leaves Ben's crew list broken per L5-01) remain in the dev DB

### Lens 6 — Information density and status redundancy

- Voice actually connected (LiveKit down): speaking rings, mic/camera chips, the people column's in-voice split, screen share on the stage, the jukebox playing with a video — the densest voice states and the fairest Discord comparison could not be reached.
- Sprint moment and game modes live: SprintMoment and GamePanel status marks and rosters read from code only.
- TV mode and TvOverlay with people in it; the ramp test mid-ride.
- The people sheet opened below 1280 (only its FAB was seen at 1100 and 900).
- Light theme for density: only dark was measured for glow (light translates glow to saturation per ADR-0005's amendment).
- The capture's state-voice-two-riders-1440-* PNGs are blank with 0 bytes of text; the same state driven with l6's own riders rendered normally, so it is left as a capture artefact, not a finding.
- A stale-presence mark on Home and the text channel after a long lobby-socket drop (#1743, #2518): the captures went offline for 10 s only and showed no mark; I did not wait for two failed reads.
- Desktop shell chrome, OS notification titles with the status emoji (#2744), and the HUD window over other apps.
- Numeric contrast of the dim tile watts vs the glowing riding bars (the theme gate owns contrast).

### Lens 7 — UX rules conformance

- Game modes in progress, the ramp test mid-ride, TV overlay with people, and sprint moments: not captured, and exercising them needs a second live rider in my own crew.
- Voice/camera/screen-share connected states and their menus: LiveKit is down on this host, so only the failure path was exercised.
- An exhaustive 'nothing lives only in a menu' pass over all 30 menus: spot-checked the playlist row (a finding), the message row, members, rider tile and person-menu only.
- Tap targets on populated lists: the 375 sweep ran as a near-empty l7 rider over 16 routes, so rows that appear only with data (queue, DM heads, rides with menus) were not measured.
- Keyboard focus order inside dialogs, the people sheet and context menus: relied on the 2026-09-16 and 09-10 audits.
- Mail templates beyond the strings in server/internal/notify/notify.go, and MCP tool descriptions' wording.
- Light theme and contrast.
- Leads owned by other lenses and not judged here: a phone spectator seeing live watts (lead 5), the recap counting a spectator and storing rode:false for riders who rode (lead 4, world.json), riders left 'riding now' after the session ends (lead 9).

### Lens 8 — Visual system, accessibility, phone width

- No screen reader was run (NVDA, VoiceOver). Accessible names come from DOM and aria inspection, not from listening.
- Forced colours were checked only through Chromium emulation on /ride and crew settings, not on a real Windows High Contrast device. prefers-contrast was not exercised.
- TV overlay, /ramp mid-ride, game modes and sprint moments were not driven, so their tap targets and contrast are read from code only.
- UpdateRow and ReleaseSheet need an update available to render. Their neon small text (L8-05) is judged from code and token contrast, not measured in the app.
- The HR-zone chips on /settings/profile need an LTHR set. Their contrast is computed from the light zone tokens, not measured.
- The recap card's 'Your numbers from this session' link did not render: my session was under 60 s, so no ride was saved. It is judged from code.
- Text over images and gradients (the landing hero, camera stand-in tiles, the CrewStrip scrim) was excluded from the contrast probe.
- WCAG 2.4.11 (focus not obscured) and 200% zoom reflow were not tested.
- Tablet widths 768–1279, where the people panel becomes a sheet, were not swept for overflow.
- The desktop shell's own chrome and /dev/* were not checked.
- Voice, camera and screen share could not be exercised: LiveKit is down on this host. Voice-only controls were not measured.

### Lens 9 — Code health, consolidation, doc drift

- make lint (golangci-lint, svelte-check, prettier) was not run: it is CI's required job and not in this lens's brief.
- The Playwright e2e suite and the desktop smoke were not run. Specs were read statically for skips and vacuous assertions only.
- The full per-route 400/404 matrix is not established. My static scanner (scratchpad/l9/matrix.py) undercounts because tests build paths through helpers, so only the 401 case was verified by hand, for crews and playlists (L9-12).
- I did not rerun the suite with -coverprofile to measure per-handler 401 branches, because the brief allows lens 9 one full test run and it was spent.
- Whether the wattroom_room_* metric names are read by the homelab deploy guard could not be verified here, so the names were not flagged; only their Help text was (L9-09).
- The SPEC Roles & permissions matrix rows were not cross-checked against handlers (another lens's scope). Neither were the ADR-0012, ADR-0034 and ADR-0060 privacy behaviours beyond the visibility-query coverage in L9-13.
- I read only the three prior audits named in the brief (09-09 consolidation, 09-17 test-suite integrity, 09-10 api-contract), not the other ~37.
- Side effect the orchestrator must know about: my first repro used ?as=l9-ana, which the dev door silently maps to the shared "Dev Rider" (L9-14). It founded crew l9-crew (id 5d53f01d-6dd4-47d5-a993-7bf6bfeb2c8f) owned by Dev Rider. Lens 3 did the same (l3-crew), so Dev Rider now holds 2 of its 3 founding slots, and one more lens founding as Dev Rider fills the cap. My attempt to hand l9-crew to my own rider and leave was blocked by the permission classifier as acting on a shared account, and the product has no crew delete (L9-03), so it is still there. All later repro used this lens's own riders, Lnine Ana and Lnine Ben, and their crew Lnine Crew (6d084222-eb18-4635-ad93-c56c00fdcf25). Other lenses using lN- names are also sharing Dev Rider.

### Lens 10 — Performance and endurance

- No real 2-hour ride was run. Endurance numbers come from 3–7 minute runs of 8 WS riders (scratchpad/l10/load.mjs) plus one Playwright rider, extrapolated linearly and labelled as estimates
- Headless Chromium spends about 30 ms/s on style and 33 ms/s on paint on the session page with ~33 layouts/s even when quiet (trace-session-agg.txt). I did not attribute it; the likely source is the infinite RidingBars animation under a drop-shadow glow, and it needs a GPU-backed profile
- The YouTube iframe's own DOM and listener growth while fake video ids errored through a queue (CDP Nodes 7.5k → 40k in 3 min) belongs to the embed, not WattRoom, and is not reported. Real video playback was not exercised
- LiveKit is down on this host: voice fan-out, camera tiles and the voice-clock XP path were not load-tested
- pg_stat_statements is not installed, so per-ping query counts in L10-06 are read from the handlers, not counted. All EXPLAINs ran on a tiny dev DB (plan shape and index availability only, no timings at scale)
- No Go benchmark of the tick: server CPU and allocations were measured process-wide from :9428/metrics while other agents were also using the server, so they are noisy
- Mobile hardware not measured; phone numbers use 4x CPU throttling at 375×812 (tickcost-juke-phone-4x.json: p50 18.7 ms per tick)
- SIDE EFFECT for the orchestrator: $NAME in this shell is the host name (SVENSPC2), so my first browser probes signed in as the shared 'Dev Rider' (9c69b35a-5eed-4de0-a6fb-9a2f4daa0ef9). Dev Rider was joined to my crew 'Lten crew' (c6594cc2-30a8-446f-bf82-85f1020d3098) and has three session rides named 'Lten probe' (359a43b2-26d7-4697-853c-576e506d2791, fb7081ca-73d5-4b41-bc56-8c88613900e5, e60c4a95-326a-4ca2-b67f-c0f625dc0373) with their XP. Undoing that through the API (delete the rides, leave the crew) was refused by the permission classifier as a shared-resource change, so it is left for the user to decide. Later probes used my own riders only
- My own probe data remains in the dev DB: crew 'Lten crew' with voice channels lten-load and lten-quiet, riders 'Lten Ana' through 'Lten Ho', 'Lten Io' and 'Lten Jo', their session rides, 497 dj_track xp_events and four dj achievements (the L10-02 reproduction)
- Seen but outside this lens: at 375 px a toast region (role=status inside the aria-label='notifications' region, max-md:top-16) intercepted clicks on the 'Ride simulated' button for 30 s while the jukebox error toasts were stacking (the tickcost.mjs phone run timed out on it)

## Method notes

- **The boundary held because it was written first.** The brief named the exclusions and gave each lens its own ground. The only cross-lens overlap was the kind the dedupe exists for: 22 merges across 147 raw findings, mostly security with privacy (open sockets after revocation), journeys with UX rules (blank routes, undo that cannot undo) and density with visual (the stale glowing watts in a dropout, reported by three lenses).
- **A security lens should describe, not demonstrate.** Lens 1's first output was withheld partway through and came back empty. The re-run was told to state each defect as class, code path, precondition, consequence and fix, never a payload, and it returned nine findings, all nine confirmed. Brief every security lens that way from the start.
- **Adversarial verification earned its cost on canon, not on code.** Of 33 verifiers, 30 confirmed, 1 left the finding plausible and 2 refuted. Both refutations were about what an ADR says (ADR-0036's whole-crew sums, ADR-0060's rider page), not about what the code does. Several verifiers also corrected a proposed fix or moved a severity, and those corrections are in the issues.
- **Revocation is the theme of the highs.** Six of the sixteen high findings are one shape: the server withdraws access in Postgres (a session row, a gate, a role, a user) and never tells the hub, an open socket, a LiveKit grant or a personal token. The issues are #2807, #2808, #2809, #2811, and the ride-loss pair #2813 and #2816. The door asks `mayEnter` every time, and nothing asks it again later. A hub-level "re-ask access for this rider" (#2807's proposed `DropUser`, #2808's `Reauthorize`) is worth designing once rather than patching six times.
- **Capture first, then the visual lenses.** Lenses 5–8 started when the capture set existed. Lens 6 counted repeated facts from the accessibility trees rather than from pixels, which is what made its inventory reproducible. The inventory is in the run's scratch directory and was not committed.
- **What the dev door accepts.** It takes letters and spaces only (`auth.go:199`). A rider name with a digit or a hyphen silently becomes the shared Dev Rider, which cost two agents a confused first attempt (bundled in #2876).

