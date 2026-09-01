# Deploying WattRoom (ADR-0002: one VM, one compose stack)

First time, on the VM:

    mkdir -p /opt/wattroom && cd /opt/wattroom
    # copy this deploy/ directory here
    cp .env.example .env            # fill it (sops-managed in the homelab repo)
    cp livekit.yaml.example livekit.yaml   # real keys, same values as .env
    docker compose -f docker-compose.prod.yml up -d

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
never restart into a ride (`wattroom_room_riders` on `/metrics` tells you), and
take a dump first, because migrations run at boot and are forward-only.

## Monitoring

One Prometheus for the homelab, not one per workload (ADR-0006's convention,
applied by ADR-0019). This stack no longer runs its own — the homelab's scrapes
the container directly over a shared docker network, which is also why nothing
has to be published to reach it:

    docker network create monitoring   # once, if the homelab stack hasn't

Put the homelab's Prometheus container on that same network, then give it:

    scrape_configs:
      - job_name: wattroom          # the job name WattroomDown matches on
        static_configs:
          - targets: ['wattroom:8080']
    rule_files:
      - /opt/wattroom/alerts.yml

and mount `/opt/wattroom/alerts.yml` into it read-only. The rules live in this
repo because they describe WattRoom's failure modes; same VM, so there is no
copy to drift. Routing to a phone and dashboards are the homelab's, per its own
rules.

`/metrics` is not reachable from the internet — Caddy 404s it, and the Go
handler is mounted bare on the mux, so that one block is the whole gate. Check
it from the VM the way Prometheus does:

    docker run --rm --network monitoring curlimages/curl -s http://wattroom:8080/metrics

The production synthetic ride — the check that proves a *ride* works rather
than that a homepage returns 200 — is not wired yet (#314). Until it is,
`WATTROOM_SYNTHETIC_TOKEN` can stay unset: `POST /api/auth/synthetic` 404s and
the path does not exist.
