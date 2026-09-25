# Deploying WattRoom (ADR-0002: one VM, one compose stack)

First time, on the VM: copy and fill [`.env.example`](.env.example), which
explains each value and what happens when an optional capability stays unset.

    mkdir -p /opt/wattroom && cd /opt/wattroom
    # copy this deploy/ directory here
    cp .env.example .env
    cp livekit.yaml.example livekit.yaml   # real keys, same values as .env
    docker compose -f docker-compose.prod.yml up -d

LiveKit runs on the host's network (WebRTC needs real UDP on the VM's
address) and everything else on the compose network, so the two never see each
other by name. Caddy reaches LiveKit as `host.docker.internal`, and LiveKit's
webhook reaches the server on the loopback port the compose publishes — keep
both if you change either side, or Join voice answers 502 and the voice radar
never moves.

Every deploy after that is a tag bump in `.env`:

    WATTROOM_TAG=2026.09.1
    docker compose -f docker-compose.prod.yml pull wattroom
    docker compose -f docker-compose.prod.yml up -d wattroom

A rollback is the same three lines with the previous tag. That works only
because migrations are expand/contract (ADR-0019): a release only adds, and
drops land one release *after* the release whose code stopped using the thing.
Break that rule and the old binary meets a schema it cannot serve.

Releases are cut with `make release`, which computes the next CalVer number
(`YYYY.0M.MICRO`), opens and merges a release PR promoting the changelog, then
tags the result — building
`ghcr.io/natrontech/wattroom:2026.09.1` and opening a GitHub Release whose
notes are that release's changelog section. Pushes to main still
build `:main` for testing; never pin the VM to it, because a moving tag has no
previous version to go back to. The server migrates its own schema at boot, so
pull + up -d is still the whole path.

Check what actually landed — the second one is a real database ping now, not a
hardcoded "ok":

    curl -s https://wattroom.ch/api/version    # {"version":"2026.09.1",...}
    curl -s https://wattroom.ch/api/healthz    # ok

## Deploying this

This directory is the **self-hosting reference**: what the app needs to run, not
what runs wattroom.ch. Deployment automation belongs to whoever operates the
box, because it has to fit their edge proxy, their metrics system and their
backup driver — for wattroom.ch that is `janlauber/homelab`, which drops the
`caddy`, `prometheus` and `backup` services below for exactly those reasons and
rolls releases out with its own timer.

If you are self-hosting, the three lines above are a complete deploy. Automate
them wherever your other services are automated, and keep two properties:
never restart into a ride (`wattroom_room_riding` on `wattroom:9091/metrics`
tells you — it counts riders with a live sample, not everyone holding a voice
channel's socket), and take a dump first, because migrations run at boot and are
forward-only.

That gauge was absent from the endpoint in **2026.09.118** and **2026.09.119**
— #1738 gave `/metrics` its own registry and this one collector kept
registering into the old one (#2321). A guard reading it on either of those two
releases saw nothing and, if it treats an unreadable count as "someone might be
riding", deferred every rollout until its own timeout. `wattroom_room_riders`
is the fallback, and it was never affected.

## Monitoring

One Prometheus for the homelab, not one per workload (ADR-0006's convention,
applied by ADR-0019). This stack does not run its own. Your Prometheus scrapes
the container directly over a shared docker network, which is also why nothing
has to be published to reach it:

    docker network create monitoring   # once, if your Prometheus stack hasn't

Put your Prometheus container on that same network, then give it:

    scrape_configs:
      - job_name: wattroom          # the job name WattroomDown matches on
        static_configs:
          - targets: ['wattroom:9091']   # the metrics listener, NOT the app port
    rule_files:
      - /opt/wattroom/alerts.yml

and mount `/opt/wattroom/alerts.yml` into it read-only. Leave `honor_labels`
off. The background-job metrics carry a `job` label of their own; the scrape's
`job="wattroom"` wins and the app's arrives as `exported_job`, which is what the
job rules select on. Turn `honor_labels` on and the app's label replaces the
scrape's, and those rules match nothing (#2679).

wattroom.ch is not wired this way. Its Prometheus runs on another VM and reads
only the rules in janlauber/homelab, which holds a hand-ported copy of
`alerts.yml`, so a rule changed here has to be ported there too. Routing to a
phone and dashboards are the homelab's, per its own rules.

`/metrics` has its own listener on **9091** (#1738), which nothing proxies:
port 8080 answers 404 there, and what the endpoint publishes no longer depends
on an edge remembering to block a path. Caddy's block stays as a second lock.
Check it from the VM the way Prometheus does:

    docker run --rm --network monitoring curlimages/curl -s http://wattroom:9091/metrics

**Upgrading past this change**: move the scrape and the deploy guard's ride
check from `wattroom:8080/metrics` to `wattroom:9091/metrics`. The old address
answers a 404 that says so, rather than an empty scrape. `WATTROOM_METRICS_ADDR`
defaults to `:9091` and moves the listener; setting it to the empty string turns
it off, which is what a deployment with no scraper at all should do. Unset and
empty differ on purpose — there is no way to ask for the default by writing it
blank.

### Are the stored credentials actually sealed?

`wattroom_identities_plaintext_refresh_tokens` on the same endpoint. It is the
number of `identities` rows still holding a Strava refresh token in the clear —
the completeness signal for ADR-0035, and the thing #1038 used to ask an
operator to run in psql against the live database:

    docker run --rm --network monitoring curlimages/curl -s http://wattroom:9091/metrics \
      | grep wattroom_identities_plaintext_refresh_tokens

Read it as:

- **`0`** — sealing is complete. Every stored credential is encrypted, and the
  `pg_dump` the deploy takes before each rollout no longer carries a usable
  Strava token. This is the reading `identities.refresh_token` may be dropped
  on, once it has held across a full release.
- **above 0** — either `WATTROOM_TOKEN_KEY` is unset, in which case credentials
  are being stored in the clear and every existing dump contains them, or the
  key is set and the boot backfill has not drained the column yet. A restart
  retries the backfill; `WattroomPlaintextRefreshTokens` in `alerts.yml` fires
  after an hour of it.
- **`NaN`** — not counted yet, which a fresh boot shows for a moment. It is
  deliberately not `0`: an uncounted gauge must not read as an all-clear.

The count refreshes every 15 minutes and the gauge keeps its last value when a
count fails, so a `0` is only worth acting on beside a fresh
`wattroom_job_last_success_timestamp_seconds{job="token seal completeness"}` —
`WattroomTokenSealCountStale` is the rule that watches that. Without Prometheus
at all, the server logs the number whenever it changes, `sealed` or not.

### How much is it used?

The same endpoint carries usage counts (#2913), recounted from the database
every five minutes: `wattroom_accounts`, `wattroom_rides`,
`wattroom_ridden_seconds`, `wattroom_ridden_joules`, `wattroom_crews`,
`wattroom_workouts`, `wattroom_tracks`, `wattroom_strava_connections` and
`wattroom_sessions_upcoming`, plus two with a `window` of `1d`, `7d` or `30d` —
`wattroom_accounts_created` (signups that still exist) and
`wattroom_riders_active` (accounts with a ride that started in the window).
Counts only: no label names a rider, a crew or a channel. `NaN` means not
counted yet, as above, and
`wattroom_job_last_success_timestamp_seconds{job="usage counts"}` says how fresh
the numbers are.

The production synthetic ride — the check that proves a *ride* works rather
than that a homepage returns 200 — is not wired yet (#314). Until it is,
`WATTROOM_SYNTHETIC_TOKEN` can stay unset: `POST /api/auth/synthetic` 404s and
the path does not exist.
