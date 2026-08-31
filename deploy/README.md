# Deploying WattRoom (ADR-0002: one VM, one compose stack)

First time, on the VM:

    mkdir -p /opt/wattroom && cd /opt/wattroom
    # copy this deploy/ directory here
    cp .env.example .env            # fill it (sops-managed in the homelab repo)
    cp livekit.yaml.example livekit.yaml   # real keys, same values as .env
    docker compose -f docker-compose.prod.yml up -d

Every deploy after that is a tag bump in `.env`:

    WATTROOM_TAG=v0.4.0
    docker compose -f docker-compose.prod.yml pull wattroom
    docker compose -f docker-compose.prod.yml up -d wattroom

A rollback is the same three lines with the previous tag. That works only
because migrations are expand/contract (ADR-0019): a release only adds, and
drops land one release *after* the release whose code stopped using the thing.
Break that rule and the old binary meets a schema it cannot serve.

Releases are cut by hand — `git tag v0.4.0 && git push --tags` — which builds
`ghcr.io/natrontech/wattroom:v0.4.0` and opens a GitHub Release whose notes are
generated from the squashed conventional-commit titles. Pushes to main still
build `:main` for testing; never pin the VM to it, because a moving tag has no
previous version to go back to. The server migrates its own schema at boot, so
pull + up -d is still the whole path.

Check what actually landed — the second one is a real database ping now, not a
hardcoded "ok":

    curl -s https://wattroom.ch/api/version    # {"version":"v0.4.0",...}
    curl -s https://wattroom.ch/api/healthz    # ok

## The VM deploys itself

Rather than the three lines above, the VM converges on the tag pinned in the
homelab repo (ADR-0019). Promotion is a one-line commit there; rollback is
`git revert` of it. Install:

    cp wattroom-update.sh /opt/wattroom/
    cp wattroom-update.service wattroom-update.timer /etc/systemd/system/
    cp wattroom-update.env.example /etc/wattroom-update.env   # then edit it
    git clone <homelab-repo> /opt/wattroom-pin                # deploy key, read-only
    systemctl enable --now wattroom-update.timer

Every five minutes it reads the pin and, if it differs from `WATTROOM_TAG` in
`.env`:

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

Watch it with `journalctl -u wattroom-update -f`, or run it once by hand with
`systemctl start wattroom-update`.

Planned maintenance is `docker compose -f docker-compose.prod.yml stop wattroom`
— Caddy then serves maintenance.html (which polls /api/healthz and reloads
itself) until `up -d wattroom` brings the binary back. No flag, no mode.

DNS: wattroom.ch A/AAAA to the VM. Caddy takes TLS from there. Open 80, 443
(tcp+udp), 7880-7881, and LiveKit's RTC UDP range on the VM firewall.

After the first deploy, set the two GitHub repository secrets that switch on
the production synthetic (#55): PROD_URL and PUSHGATEWAY_URL. Grafana points
at the prometheus service; dashboards are the homelab's, per its own rules.
