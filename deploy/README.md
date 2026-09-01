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

## The VM deploys itself

Rather than the three lines above, the VM tracks the newest published release
by itself (ADR-0019). Cutting a release *is* deploying it. Install:

    cp wattroom-update.sh /opt/wattroom/
    cp wattroom-update.service wattroom-update.timer /etc/systemd/system/
    cp wattroom-update.env.example /etc/wattroom-update.env   # then edit it
    systemctl enable --now wattroom-update.timer

It reuses the credential `docker login ghcr.io` already stored, so there is no
new secret and no repo to clone.

Every five minutes it takes the highest CalVer tag in the registry and, if it
differs from what is actually serving:

1. **refuses to interrupt a ride** — a server that answers with riders on it
   defers to the next tick. A count it cannot read from a *responding* server
   also defers: a missed deploy costs five minutes, a deploy into a group ride
   costs the ride.
2. `pg_dump`s to `backups/`. No dump, no deploy.
3. pulls and `up -d`s the new tag, then waits up to `GATE_TIMEOUT` for
   `/api/version` to report *that* tag and `/api/healthz` to answer 200. It
   asks over `127.0.0.1:8080`, which the stack publishes for exactly this —
   loopback is not an exposure, and `/metrics` has no route through Caddy.
4. on failure, retags to the previous release and brings it back — then checks
   that too, because a failed rollback is the one thing that must page.
5. only then writes the new tag into `.env`. A run killed before that leaves
   `.env` naming the last release known to work.

It never restores a dump. That would discard every ride recorded since the
dump, which is worse than the bug being rolled back from — restoring is a
break-glass path with a person present. Automated recovery stops at the image.

**Rolling back on purpose**, or holding a version: put the tag in
`WATTROOM_PIN` in `.env` and `up -d wattroom`. While that is set the updater
leaves the box alone — without it, tracking would put the newest release
straight back. A failed health gate sets the same field for you, so a bad
release cannot be retried every five minutes overnight. Clear it to resume.

Watch it with `journalctl -u wattroom-update -f`, or run it once by hand with
`systemctl start wattroom-update`.

Planned maintenance is `docker compose -f docker-compose.prod.yml stop wattroom`
— Caddy then serves maintenance.html (which polls /api/healthz and reloads
itself) until `up -d wattroom` brings the binary back. No flag, no mode.

DNS: wattroom.ch A/AAAA to the VM. Caddy takes TLS from there. Open 80, 443
(tcp+udp), 7880-7881, and LiveKit's RTC UDP range on the VM firewall.

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
