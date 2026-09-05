# Launch runbook — wattroom.ch

Everything between here and the first crew ride, in order. The code side is
done: every tagged release builds an image that migrates itself at boot, and
it was smoke-tested with zero providers configured (the login screen says so
honestly instead of rendering dead buttons). What follows is the part only
a human with the accounts can do.

## 1. Register the OAuth apps (blocks all sign-ins — do this first)

Every app uses the same callback shape: `https://wattroom.ch/api/auth/<provider>/callback`.

| Provider | Where | Callback URL | Scopes the server requests |
|---|---|---|---|
| Google | console.cloud.google.com → APIs & Services → Credentials → OAuth client (Web application) | `https://wattroom.ch/api/auth/google/callback` | `openid profile` |
| GitHub | github.com/settings/developers → New OAuth App | `https://wattroom.ch/api/auth/github/callback` | `read:user` |
| Strava | strava.com/settings/api | Authorization Callback Domain: `wattroom.ch` | `read,activity:write` (upload scope now — no re-consent later, #34) |

Notes:
- Google wants an OAuth consent screen first (External, app name WattRoom,
  no sensitive scopes → no review needed).
- The IDs/secrets go into `deploy/.env` as
  `WATTROOM_OAUTH_{GOOGLE,GITHUB,STRAVA}_{ID,SECRET}` — sops-managed in the
  homelab repo, never in this one.
- Any provider left unset simply doesn't render a button (capability
  gating); you can launch with one and add the rest later.

## 2. VM + DNS (#36)

1. Provision the VM (2 vCPU / 4 GB is plenty for the alpha), Docker + compose.
2. `wattroom.ch` A/AAAA → the VM. (.ch is registered on Cloudflare —
   set the record to **DNS only**, not proxied: LiveKit's UDP won't cross
   Cloudflare's proxy.)
3. Firewall: 80, 443 (tcp+udp for HTTP/3), 7880–7881, and the LiveKit RTC
   UDP range from `livekit.yaml`.
4. Follow `deploy/README.md`: copy `deploy/` to `/opt/wattroom`, fill
   `.env` + `livekit.yaml` from sops, set `WATTROOM_TAG` to a release,
   `docker compose -f docker-compose.prod.yml up -d`. The server migrates
   its own schema at boot — there is no separate migration step, ever.

## 3. After the first deploy

- Repo secrets `PROD_URL` + `PUSHGATEWAY_URL` → the synthetic check (#55)
  starts watching production.
- Sanity pass, in this order:
  1. `https://wattroom.ch/api/healthz` → `ok`
  2. `/` signed out → the landing page
  3. Sign in with each configured provider once (this is also the account
     the first room will belong to)
  4. Open a room, pair the Kickr, ride two minutes, End ride → the ride is
     on /history
  5. Phone on the share link (`/r/<slug>`) → lands in the room itself: the
     drawer carries its places, the crew strip everyone's watts. There is
     no separate spectator view any more (#412); the old `/r/<slug>/watch`
     URL redirects here.
- Then invite the crew. Rooms are private by default; the share link is the
  whole invite.

## 4. First crew ride checklist

- Schedule it in the room (the upcoming card) so everyone sees it.
- TV mode on the biggest screen; the join code is on it when idle.
- Every rider: Chrome/Edge on desktop, trainer on FTMS, FTP set in profile
  (the ramp test works day one).
- The jukebox needs no YouTube API key: links and playlists resolve
  client-side via the IFrame player and keyless oEmbed
  ([ADR-0026](decisions/0026-a-playlist-is-one-queue-entry.md)). Nothing in
  `.env` is jukebox-related.
- Afterwards: the flag button + `/api` feedback loop is live — reports
  become issues automatically (ADR-0006).

## Rollback

Rollback is an image tag, never the database
([ADR-0019](decisions/0019-tagged-releases-and-a-self-converging-vm.md)).
Only tagged releases deploy — `:main` builds on every merge and is never
pinned. For wattroom.ch the operator's homelab timer owns the whole loop: it
rolls out the newest release, refuses to interrupt a ride, dumps first, and
retags to the previous release itself when the health gate fails; a
deliberate rollback pins the previous release for that timer (ADR-0019's
`WATTROOM_PIN`), not a sha excavated from an Actions log. A
self-hoster following `deploy/README.md` sets `WATTROOM_TAG` in `.env` to
the previous release and `up -d wattroom`. Either way the schema stays at
the newer version, which is safe only because migrations are
expand/contract — a release only adds, and drops land one release after the
code stopped using the thing. Nothing restores a dump automatically: that
would discard every ride since it.
