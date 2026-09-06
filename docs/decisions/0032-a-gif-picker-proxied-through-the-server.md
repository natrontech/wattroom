# 0032 — The GIF picker is proxied, and it posts a plain chat message

- Status: accepted, amended 2026-09-06 (#909: the provider is GIPHY, not
  Tenor, and the quota is shared)
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

Several things had to be settled before writing it, and nothing in the
repository settled any of them.

## Decision

**GIPHY.** ~~Tenor, not Giphy.~~ *Amended #909.* The original decision picked
Tenor for a cheaper attribution: both were already on #279's render allowlist,
so neither moved the rendering side, and Tenor asked for a text credit where
GIPHY's terms want their mark.

That decision was wrong on a fact nobody checked. **Google stopped issuing
Tenor API keys on 13 January 2026 and shut third-party access off entirely on
30 June 2026** — three months before this ADR was written. The endpoint
reference was read for its parameter tables; the discontinuation notice on the
same site was not. The picker shipped in #888 against an API that had not
existed for ten weeks, gated behind an environment variable nobody could
obtain, and the verification run proved only that a local stub of a dead
service behaved as expected.

So: GIPHY, whose hosts #279 had already allowlisted, which means the client
needed no change and the agreeing-allowlists property below survived the swap
untouched. Klipy — built by former Tenor staff, near-identical API, where
WhatsApp went — was the other candidate and would have needed new hosts
trusted on both sides. The footer credit reads *Powered by GIPHY*; their
guidelines want the official mark, and shipping that asset is a follow-up.

**The server proxies; the browser never holds the key.** A browser-side key is
a published key — anyone can read it out of the bundle and spend the quota.
Proxying keeps it in the process environment (`WATTROOM_GIPHY_KEY`) and, more
usefully, gives the ceiling somewhere to live.

This does **not** hide riders from GIPHY: the results render as `<img>`
straight off `media*.giphy.com`, so the CDN sees every member's IP the moment
the grid draws, exactly as it already did for a pasted GIF. The proxy is about
the key and the quota. Claiming it as a privacy measure would be false, and
routing the image bytes through the server to make it true would put a media
proxy on a single VM to save nothing WATTROOM.md's privacy rules cover — those
govern metrics, not which CDN a rider's browser talks to.

**The proxy returns only URLs the client would render anyway.** `internal/gifs`
drops any result whose GIF URL is not HTTPS on a GIPHY media host with a
`.gif`/`.webp` path — the same predicate `gifUrl()` applies. GIPHY's URLs carry
tracking query parameters, which is why both sides test the path and not the
whole string. Without this check, a malformed or hostile upstream response
could put an arbitrary host into an `<img>` in the grid, and a picked tile
could post a bare URL as text. The two allowlists agreeing is what makes
"picking a tile posts a message" safe.

**A picked GIF is a chat message, not a new kind of content.** The message text
is the URL; the hub, the protocol, the bounded chat log and the phone
spectator's `preview={false}` plain-link view all keep working untouched. There
is no `gifId`, no migration, and nothing to prune. The picker is a nicer way to
produce a string chat has understood since #279.

**Two ceilings and a cache, because the quota is shared.** *Amended #909.*
The original ceiling was 40 searches a minute per account, which assumed a
per-rider budget. A GIPHY key has no such thing: the free tier is roughly 42
searches an hour and 1000 a day **for the whole server**, and a production key
needs GIPHY's approval. One rider typing one word could have spent the hour.

- A 10-minute response cache, consulted before either ceiling. Trending is the
  same answer for every rider and is what every picker-open asks for first, so
  this is most of the saving; a cached page is charged to nobody.
- `keyLimit`: 30 upstream calls an hour, server-wide, leaving headroom under
  the free tier. Over it, 503 `rate_limited` — a shared resource is full, which
  is exactly what that code is for, and the copy does not blame the rider's
  input.
- `rateLimit`: 15 upstream calls a minute per account, so one rider cannot be
  the reason the budget ran out. Over it, 429 `rate_limited`.

Both count upstream calls, never requests, and a refused call is charged to
neither. The picker's debounce moved 300ms → 600ms for the same reason.

**`rating=g`, hard-coded** (`contentfilter=high` before #909). The 95% rule:
this is a default, not a room setting, and the 5% it would not suit is not an
audience to configure for.

## Consequences

- A server with no `WATTROOM_GIPHY_KEY` leaves `GET /api/gifs` unmounted and
  `gifsEnabled` false on `/api/me`; the composer's GIF button does not render.
  wattroom.ch sets the key, self-hosters need not, and neither sees a broken
  affordance. Same shape as LiveKit (#219) and Resend (#117).
- The picker lands in `MessageThread.svelte`, so it is in room chat and DMs at
  once — #672's shared composer is why this was one change and not two.
- Tenor's hosts stay on `media.ts`'s allowlist. Their API is gone; their CDN
  still serves the URLs riders pasted under #279, and those messages should
  keep rendering.
- We do not fire GIPHY's `analytics` pingbacks (`onload`/`onclick`/`onsent`).
  They feed their ranking and cost a round trip per send; if the results ever
  feel stale, that is the first thing to add.
- **Check that an API still accepts clients before writing it into an ADR.**
  This one cost a merged feature and a same-day revert of its provider. A
  vendor's reference pages outlive the vendor's willingness to serve.
- Stickers remain undecided — #879 holds that question, and this ADR does not
  answer it.
