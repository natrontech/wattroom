# Launch runbook — wattroom.ch

Everything between here and the first crew ride, in order. The code side is
done: the image builds from main, migrates itself at boot, and was
smoke-tested with zero providers configured (the login screen says so
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

## 2. YouTube API key (jukebox link resolution)

console.cloud.google.com → same project → enable **YouTube Data API v3** →
API key, restricted to that API. Into `.env` per `.env.example`.

## 3. VM + DNS (#36)

1. Provision the VM (2 vCPU / 4 GB is plenty for the alpha), Docker + compose.
2. `wattroom.ch` A/AAAA → the VM. (.ch is registered on Cloudflare —
   set the record to **DNS only**, not proxied: LiveKit's UDP won't cross
   Cloudflare's proxy.)
3. Firewall: 80, 443 (tcp+udp for HTTP/3), 7880–7881, and the LiveKit RTC
   UDP range from `livekit.yaml`.
4. Follow `deploy/README.md`: copy `deploy/` to `/opt/wattroom`, fill
   `.env` + `livekit.yaml` from sops, `docker compose -f
   docker-compose.prod.yml up -d`. The server migrates its own schema at
   boot — there is no separate migration step, ever.

## 4. After the first deploy

- Repo secrets `PROD_URL` + `PUSHGATEWAY_URL` → the synthetic check (#55)
  starts watching production.
- Sanity pass, in this order:
  1. `https://wattroom.ch/api/healthz` → `ok`
  2. `/` signed out → the landing page
  3. Sign in with each configured provider once (this is also the account
     the first room will belong to)
  4. Open a room, pair the Kickr, ride two minutes, End ride → the ride is
     on /history
  5. Phone on the share link → lands on the spectator view
- Then invite the crew. Rooms are private by default; the share link is the
  whole invite.

## 5. First crew ride checklist

- Schedule it in the room (the upcoming card) so everyone sees it.
- TV mode on the biggest screen; the join code is on it when idle.
- Every rider: Chrome/Edge on desktop, trainer on FTMS, FTP set in profile
  (the ramp test works day one).
- Afterwards: the flag button + `/api` feedback loop is live — reports
  become issues automatically (ADR-0006).

## Rollback

The image is tagged per-commit on ghcr (`publish.yml`). Pin
`docker-compose.prod.yml` to the previous sha tag and `up -d wattroom`.
Migrations are additive so far; nothing has needed a down-migration.
