# Launch runbook — wattroom.ch

Everything between here and the first crew ride, in order. The code side is
done: every tagged release builds an image that migrates itself at boot, and
it was smoke-tested with zero providers configured (the login screen says so
honestly instead of rendering dead buttons). What follows is the part only
a human with the accounts can do.

## 1. Register the OAuth apps (blocks all sign-ins — do this first)

Every app uses the same callback shape: `https://wattroom.ch/api/auth/<provider>/callback`.

| Provider | Where                                                                                     | Callback URL                                   | Scopes the server requests                                          |
| -------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| Google   | console.cloud.google.com → APIs & Services → Credentials → OAuth client (Web application) | `https://wattroom.ch/api/auth/google/callback` | `openid profile`                                                    |
| GitHub   | github.com/settings/developers → New OAuth App                                            | `https://wattroom.ch/api/auth/github/callback` | `read:user`                                                         |
| Strava   | strava.com/settings/api                                                                   | Authorization Callback Domain: `wattroom.ch`   | `read,activity:write` (upload scope now — no re-consent later, #34) |

Notes:

- Google wants an OAuth consent screen first (External, app name WattRoom,
  no sensitive scopes → no review needed).
- GitHub must be an **OAuth App**, not a GitHub App: the server uses the
  classic web flow. Scopes are not configured on the app — `read:user` is
  requested at authorize time.
- The IDs/secrets go into `deploy/.env` as
  `WATTROOM_OAUTH_{GOOGLE,GITHUB,STRAVA}_{ID,SECRET}` — sops-managed in the
  homelab repo, never in this one.
- Any provider left unset simply doesn't render a button (capability
  gating); you can launch with one and add the rest later.

**Two traps when you set them (#820, both met on 2026-09-06):**

1. **The restart is what applies it.** `providersFromEnv` runs once inside
   `auth.New` at boot, so an env edit alone changes nothing — this is the step
   that looks like the credentials were wrong. `docker compose restart` will
   not do: it does not re-read the env file. It has to be
   `docker compose up -d wattroom`.
2. **Do not clobber the runtime image pin.** The operator's deployment keeps
   `WATTROOM_IMAGE` (`tag@sha256:…`) in the target's `.env`, written by the
   auto-updater and deliberately absent from the encrypted source. A push that
   overwrites the whole file drops it, and the restart then falls back to the
   compose default — an older release. Nothing is lost, and the updater rolls
   forward on its next tick, but the deploy goes backwards at exactly the
   moment you are watching for a new button to appear.

Then verify, which is the only thing that proves any of it:

```bash
curl -s https://wattroom.ch/api/auth/providers
# want: {"providers":["github","strava"]} — that order is the server's, not your file's
```

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
     that founds the first crew)
  4. Start a crew — it opens with a text channel and a voice channel — walk
     into the voice channel, pair the Kickr, start a session, ride two
     minutes, End ride → the ride is on /history
  5. Phone on the crew's invite link (`/c/<code>`, from the crew's page)
     → joins the crew, then walks into the voice channel from the sidebar,
     which carries the crew's channels; a running session shows everyone's
     watts. There is no separate spectator view any more (#412); an old
     `/r/<slug>/watch` link lands on the voice channel or its running
     session (#2458).
- Then invite the crew: the crew's code or link is the whole invite (#1236).
  A new channel is open to the crew; make it private in the crew's Settings
  if it is for some of them only, and name the rest into it one by one there.

## 4. First crew ride checklist

- Schedule it on the crew's Schedule page so everyone sees it.
- TV mode on the biggest screen; the crew's code is on it when idle.
- Every rider: Chrome/Edge on desktop, trainer on FTMS, FTP set in profile
  (the ramp test works day one).
- The jukebox needs no YouTube API key: links and playlists resolve
  client-side via the IFrame player and keyless oEmbed
  ([ADR-0026](decisions/0026-a-playlist-is-one-queue-entry.md)). Nothing in
  `.env` is jukebox-related.
- Afterwards: the flag button + `/api` feedback loop is live — reports
  become issues automatically (ADR-0006).

## 5. Getting found (#2995)

The site is ready to be read: prerendered pages, a sitemap, share cards and structured data (ADR-0061). What follows needs your accounts. The research behind the order is [RESEARCH.md §19](RESEARCH.md).

**Once, this week:**

1. **Google Search Console.** Add a **Domain property** for `wattroom.ch` and verify it with the DNS TXT record Google gives you, in Cloudflare. That covers every subdomain and protocol, and needs no deploy. Then:
   - Submit `https://wattroom.ch/sitemap.xml`.
   - Use URL inspection → "Request indexing" on `/`, `/group-workouts` and `/zwift-alternative`.
2. **Bing Webmaster Tools.** Import the site from Search Console; the sitemap comes with it. ChatGPT's search leans on Bing's index, so this is the cheap half of AI-search visibility. (Cloudflare's Crawler Hints only works for proxied traffic, and wattroom.ch is DNS-only for LiveKit, so skip it.)
3. **The repository's front door.**
   - Upload `docs/assets/social-preview.png` under Settings → General → Social preview (1280×640, drawn by `make screenshots`).
   - Set the About box's website to `https://wattroom.ch`.
   - Add topics: `indoor-cycling`, `zwift-alternative`, `smart-trainer`, `web-bluetooth`, `ftms`, `group-workouts`, `self-hosted`, `sveltekit`, `golang`, `livekit`.
4. **Check that it all landed.**
   - `curl -s https://wattroom.ch/ | grep '<h1'` shows the headline.
   - The [Rich Results Test](https://search.google.com/test/rich-results) on `/` finds `WebApplication`, `WebSite` and `Organization`.
   - Pasting a page's link into Slack or Discord shows its card.

**Listings, most useful first.** Mentions on other sites drive AI answers more than anything on ours (§19.6). Every one of these is a post under your name, so they are yours to make:

1. **[AlternativeTo](https://alternativeto.net/software/zwift/)**: suggest WattRoom as an alternative to Zwift, TrainerRoad and MyWhoosh. Its Zwift page lists one open-source entry today. It reportedly wants an account about a week old.
2. **[awesome-web-bluetooth](https://github.com/urish/awesome-web-bluetooth)** and **[awesome-cycling](https://github.com/Dunky-Z/awesome-cycling)**: a one-line PR to each.
3. **Editorial "best free indoor cycling apps" lists.** Write to the editor, with a link to `/zwift-alternative`:
   - [BikeRadar](https://www.bikeradar.com/advice/buyers-guides/best-free-indoor-cycling-apps)
   - [Cyclist](https://www.cyclist.co.uk/buying-guides/buyers-guide-best-cycling-training-apps)
   - [indoorcyclingtips](https://indoorcyclingtips.com/best-free-zwift-alternatives-2026/)
   - In German, with a link to `/de`: [TOUR](https://www.tour-magazin.de/fitness/indoortraining/indoor-training-4-virtuelle-apps-furs-rollentraining-im-vergleich/), [mission-triathlon](https://mission-triathlon.de/apps-fuers-indoor-cycling-im-test/) and [Ergon](https://www.ergonbike.com/de/magazin/indoor-cycling-apps-kostenlos)
4. **Reddit.** r/selfhosted suits the self-host angle, and r/indoorcycling suits the crew angle. Read each sidebar's self-promotion rule first. r/Zwift will likely read a post as an ad.
5. **Show HN.** It wants something people can try without signing up, which WattRoom does not have yet: the landing's sprint and FTP slider are the closest. Post when there is a demo crew a visitor can watch.
6. **[awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted-data)**, tag `Health and Fitness`. Its rule is a first release more than four months old, so it is **eligible from 2026-12-31** (the first release was 2026-08-31).
7. **Product Hunt**, once there is a story worth the day: group ERG rides with voice, free.
8. **Later.** Reviewers like DC Rainmaker, GPLama and Shane Miller cover hardware first. Pitch one when there is a story, not before.

`awesome-go` does not fit: it wants semver tags, and CalVer's `2026.09.1` is not one. Neither does `awesome-sveltekit` until the repo has around 50 stars.

**Every month:** `/vs/*` and `/zwift-alternative` state prices and facts about other products, dated in `web/src/lib/site/seo.ts` (`CHECKED`). Re-check them against the sources in `rivals.ts`, update, and bump the date. A stale price on a comparison page costs more trust than the page earns.

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
