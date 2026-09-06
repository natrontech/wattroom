# 0032 — The GIF picker is Tenor, proxied, and it posts a plain chat message

- Status: accepted
- Date: 2026-09-06
- Builds on: #279, which put GIFs in chat as inline renders of pasted
  allowlisted URLs and explicitly parked the picker as "needs its own decision"
- Extends: `.claude/rules/ux.md` capability gating — a third feature that is
  absent rather than broken when its key is unset

## Context

Since #279 a rider sends a GIF by opening a second tab, finding one, copying
its **direct media** URL, and pasting it into the composer; `gifUrl()` renders
a message that is exactly one allowlisted URL as the GIF itself. That path
works and stays. It is also a desk-with-two-tabs manoeuvre: mid-ride, one hand
on the bars, it is unusable, and on the phone spectator view there is no second
tab to copy from. #878 asks for the picker that closes the gap.

Four things had to be settled before writing it, and nothing in the repository
settled any of them.

## Decision

**Tenor, not Giphy.** Both were already on #279's render allowlist, so neither
choice moves the rendering side. Tenor's key is free and its terms ask for a
text credit; Giphy's require the "Powered by GIPHY" mark as an image asset in
the picker chrome. One line of text is cheaper than a bundled logo, and the
picker footer carries it: *GIFs via Tenor*.

**The server proxies; the browser never holds the key.** A browser-side key is
a published key — anyone can read it out of the bundle and spend the quota.
Proxying keeps it in the process environment (`WATTROOM_TENOR_KEY`) and, more
usefully, gives the ceiling somewhere to live.

This does **not** hide riders from Tenor: the results render as `<img>`
straight off `media*.tenor.com`, so the CDN sees every member's IP the moment
the grid draws, exactly as it already did for a pasted GIF. The proxy is about
the key and the quota. Claiming it as a privacy measure would be false, and
routing the image bytes through the server to make it true would put a media
proxy on a single VM to save nothing WATTROOM.md's privacy rules cover — those
govern metrics, not which CDN a rider's browser talks to.

**The proxy returns only URLs the client would render anyway.** `internal/gifs`
drops any result whose GIF URL is not HTTPS on a Tenor media host ending in
`.gif`/`.webp` — the same predicate `gifUrl()` applies. Without that, a
malformed or hostile upstream response could put an arbitrary host into an
`<img>` in the grid, and a picked tile could post a bare URL as text. The two
allowlists agreeing is what makes "picking a tile posts a message" safe.

**A picked GIF is a chat message, not a new kind of content.** The message text
is the URL; the hub, the protocol, the bounded chat log and the phone
spectator's `preview={false}` plain-link view all keep working untouched. There
is no `gifId`, no migration, and nothing to prune. The picker is a nicer way to
produce a string chat has understood since #279.

**Per-account ceiling, in memory: 40 searches a minute.** One key pays for
every rider. A debounced keystroke is one search, so the ceiling is generous
for a person and tight for a script; over it, 429 `rate_limited`, whose advice
— wait, then retry — is the same one the rider needs when Tenor itself is down
(503, same code, per `.claude/rules/errors.md`).

**`contentfilter=high`, hard-coded.** The 95% rule: this is a default, not a
room setting, and the 5% it would not suit is not an audience to configure for.

## Consequences

- A server with no `WATTROOM_TENOR_KEY` leaves `GET /api/gifs` unmounted and
  `gifsEnabled` false on `/api/me`; the composer's GIF button does not render.
  wattroom.ch sets the key, self-hosters need not, and neither sees a broken
  affordance. Same shape as LiveKit (#219) and Resend (#117).
- The picker lands in `MessageThread.svelte`, so it is in room chat and DMs at
  once — #672's shared composer is why this was one change and not two.
- We do not call Tenor's `registershare`. It feeds their ranking and costs a
  round trip per send; if the results ever feel stale, that is the first thing
  to add.
- Stickers remain undecided — #879 holds that question, and this ADR does not
  answer it.
