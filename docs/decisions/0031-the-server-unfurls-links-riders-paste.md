# 0031 — The server unfurls links riders paste, behind a pinned-address fetch

- Status: accepted
- Date: 2026-09-06
- Builds on: [ADR-0009](0009-login-gated-app.md) (the app is login-gated, so
  every outbound fetch is on behalf of a signed-in rider),
  [ADR-0010](0010-room-first-positioning.md) (chat is room-scoped)
- Read against: [ADR-0032](0032-a-gif-picker-proxied-through-the-server.md),
  which reaches the opposite conclusion about proxying image bytes. The two
  were written the same day and the difference is deliberate — see
  "Why this proxies bytes when the GIF picker does not" below.

## Context

Chat previewed exactly two hosts. `LinkPreview.svelte` called YouTube's and
Spotify's keyless oEmbed endpoints from the browser, and its own comment named
why it stopped there:

> A generic unfurl would need a server-side OG fetcher (CORS + SSRF), so
> anything else just stays a link.

That is accurate, and it is not a decision anybody wrote down — it is a
constraint somebody worked around. Almost nothing on the web sends
`Access-Control-Allow-Origin` to a page that is not its own; Steam's storefront
API does not, and neither do news sites, code hosts, or the shops riders
actually link. So every link that is not YouTube or Spotify arrived as bare
text in an app that otherwise looks like a messenger.

The blocker was never the parsing. It was that a server which fetches a URL a
stranger typed is a **server-side request forgery primitive**, and this one is
reachable by any rider who can type in a chat box. It can be aimed at the
operator's private network, at a cloud metadata endpoint, at another service on
the same host — anywhere the server can reach and the rider cannot.

The second question is the rider's, not the operator's. A preview card carries
a picture. An `<img>` pointed at the linking site hands every reader's IP
address, and their `User-Agent`, to whoever's link it was — for every card in
the scrollback, the moment the pane opens. `media.ts` already refuses exactly
this for pasted GIFs, allowlisting a handful of hosts, and a preview thumbnail
is the same exposure at a much larger scale.

## Decision

**WattRoom fetches link metadata itself, from the server, for signed-in riders
only.** `GET /api/unfurl?url=…` returns title, description, image and site name
parsed out of Open Graph, with `<title>` and the description meta as fallback.
No allowlist: an allowlist of hosts is a list somebody has to keep, and the
sites riders link are not a set anybody can enumerate.

**The safety is in the fetch, not in a list of approved hosts.** The policy,
all of it enforced in `server/internal/unfurl`:

- **http and https only**, checked on the rider's URL and again on every
  redirect target. `file:`, `gopher:`, `data:` are refused at every hop.
- **The name is resolved before connecting, every answer is judged, and the
  connection is pinned to the address that was judged.** This is the part that
  matters. Checking a hostname and then handing the *name* to the dialer leaves
  a window in which the resolver can answer differently the second time — a DNS
  rebind — and the check protects nothing. There is no window here: the dialer
  resolves, rejects, and dials an IP literal.
- **What counts as reachable**: global-unicast, non-private addresses only.
  Loopback, unspecified, multicast, link-local (which is where the cloud
  metadata endpoint lives), RFC 1918, RFC 4193, CGNAT, the benchmarking and
  documentation ranges — refused, in v4 and v6. A v4 address wearing a v6
  costume (v4-mapped, NAT64, 6to4) is judged as the v4 address it is, or every
  rule above has a bypass.
- **Web ports only** (80, 443, 8080, 8443), on the rider's URL and on every
  redirect. A public address is still an address with an SSH daemon and a
  database behind it; without this rule the endpoint is a port scanner anyone
  with a chat box can aim at any host on the internet.
- **Ceilings on everything**: redirect hops, response bytes, connection time,
  total time. HTML content types only. Parsing stops at `<body>`, because the
  metadata is in the head and the rest is a stranger's markup.
- **No WattRoom credential ever leaves.** The outbound request carries a
  `User-Agent` naming the bot and nothing else — no cookie, no token, no header
  derived from the rider's request.
- **A per-rider ration and ~~a shared response cache~~**, so ~~a room full of
  people reading the same link costs that site one request, and~~ no rider can
  turn the endpoint into an amplifier pointed at somebody else.
  **Diverged 2026-09-10 (#1739)**: the cache is keyed on `(rider, url)`. Shared,
  it was read before the ration was spent, so a free answer told any signed-in
  rider whether somebody else had pasted that link inside the TTL — the
  amendment below has the argument and the price. The ration is a bucket, not
  a spacing between asks: opening a busy channel asks for every distinct
  link on the screen at once, and a fixed gap would refuse most of them for no
  reason the rider could see. A spent bucket answers **429, never 204** — the
  client remembers "there is nothing here" for the session and must never
  remember "ask again" as if it were that. It waits the bucket's refill out
  instead, holding the same promise, so a card that was merely early still
  lands on the message rather than leaving a bare URL behind.

**Preview images are proxied through our own origin.** The card's image URL
addresses `GET /api/unfurl/image?url=…`, which fetches through the same guard,
caps the bytes, and serves with `nosniff`. The browser never contacts the
linked site, so reading a chat does not tell the sites other people linked
that you were there.

Only PNG, JPEG, GIF, WebP and AVIF come back through it. **SVG is refused**:
it is a document, not a picture, and one served from our own origin runs its
own script as WattRoom the moment a rider opens the image in a tab. The
response also carries a `default-src 'none'; sandbox` CSP, but not serving the
format is the answer that does not depend on a header being honoured.

### Why this proxies bytes when the GIF picker does not

[ADR-0032](0032-a-gif-picker-proxied-through-the-server.md) proxies the GIF
provider's *API* for the key and the quota, and says plainly that it does not
hide riders from that provider — the grid renders straight off its CDN. (Which
provider has already changed once, Tenor to GIPHY per #909; the argument below
does not depend on which.) It goes further
and rejects the idea of proxying the bytes: that would "put a media proxy on a
single VM to save nothing WATTROOM.md's privacy rules cover — those govern
metrics, not which CDN a rider's browser talks to."

That reasoning is right for a GIF picker and wrong for a link preview, and the
difference is who chose the host.

- A rider **opens** the picker. They are searching one provider, on purpose,
  and the host is a fixed, allowlisted CDN. Their address reaching it is a
  consequence of something they did.
- A preview image is fetched **passively**, while scrolling, from a host **some
  other member chose** by pasting a link. Nobody scrolling the room decided to
  contact it.

That second shape is not a CDN question. It is a member-controlled
IP-disclosure primitive: paste a link to a host you run, and every member who
scrolls past the message hands you their address, their user-agent, and a
timestamp — without clicking anything. Room membership is not supposed to buy
that (WATTROOM.md, "Privacy is architecture"), and `media.ts` already refused
exactly this for pasted GIFs by allowlisting a handful of hosts rather than
rendering an `<img>` to whatever was in the message.

So the rule is not "proxy image bytes" or "never proxy image bytes". It is:
**bytes from a host the rider chose may load directly; bytes from a host
another member chose go through us.** ADR-0032's fixed CDN allowlist is the
first case, an arbitrary unfurled page is the second.

The cost ADR-0032 names is real and is accepted here: preview-image bandwidth
lands on the single VM. It is bounded per image and per rider, and it buys
something the GIF grid had no need to buy.

### The proxy is not a second SSRF surface

The image proxy is a second guarded fetcher, not a second SSRF surface: it
dials through the same policy, for the same signed-in riders, and so grants no
reach the unfurl endpoint beside it does not already grant. It is therefore not
separately signed or tokenised — a signed URL would add key management and
break every already-rendered card across a restart, in exchange for closing a
door that is not open.

**YouTube and Spotify keep their oEmbed path.** Those two answer the browser
directly, with richer data than their Open Graph tags, and cost the server
nothing. Everything else goes through the unfurl.

**Nothing here is ever an error the rider reads.** A refused address, a
timeout, a page with no metadata: all of them mean "no card". A dead preview
costs nothing — the link still works.

## Consequences

- Every link gets a preview, which is what the chat has needed to stop feeling
  half-built. Steam, the case that prompted this, works because nothing about
  it is special any more.
- **The server now makes outbound requests to addresses riders choose.** That
  is a real, permanent increase in what this app does, and the guard is what
  keeps it bounded. Changes to `guard.go` are security changes: its refusal
  tests are the specification. The rule this sets is about **rider-supplied**
  addresses — any new code that fetches a URL a rider can influence must go
  through `Service.get`, or it reopens everything this closes. A fetcher aimed
  at one fixed host the operator configured (`internal/gifs` calling its GIF provider, the
  Strava and LiveKit clients) is a different thing and needs no guard, because
  there is no address for an attacker to choose.
- An operator running WattRoom inside a network with private services can no
  longer assume the app never speaks to them — it will not, but that is now a
  property of code rather than a property of the app having no such feature.
- The preview cache means a title fixed at the source takes up to half an hour
  to be fixed here. ~~That is the trade for not asking a site once per reader.~~
  **Diverged 2026-09-10 (#1739)**: a site now is asked once per reader. What the
  TTL buys is one rider re-reading one conversation for free.
- The proxy puts preview-image bandwidth on the WattRoom host. Bounded per
  image and per rider, but it is a cost the previous design did not have —
  paid, deliberately, so no rider's address leaks to strangers' hosts.
- `golang.org/x/net/html` joins the dependency list, beside the
  `golang.org/x/image` the OG card renderer already uses. Hand-rolling an HTML
  scanner is exactly where parsing bugs live, and this is the tokenizer the Go
  team maintains.

## Amendment, 2026-09-10 (#1739): the preview cache is keyed on `(rider, url)`

The cache above was keyed on the URL alone and shared across the instance, and
`handleUnfurl` reads it before spending a ration token — it has to, or a rider
opening a chat with fifteen links would be refused their own second look at it.
Both halves are right on their own and wrong together: an entry another rider
paid for answered for free, and a free answer is a yes/no on whether somebody
else on this instance pasted that URL inside the last half hour. A rider only
has to time `GET /api/unfurl?url=…` against a link they suspect. Negatives carry
the same tell, because a page with no metadata is cached too, so it works on
URLs that never draw a card — an unlisted document, a job posting, a clinic.
That is other people's reading, which is not a thing this app holds.

Three ways out were on the table: spend a ration token on hits, key the cache
per rider, or accept the tell. Spending a token on hits makes the question cost
something without making it unanswerable, and it prices the ordinary case — a
busy channel re-rendering — as if it were the attack. Keying per rider ends the
question outright.

**The cache is keyed on `(rider, url)`.** The price is stated rather than
hidden: a link twenty riders read is fetched twenty times, not once, and this
ADR's "costs that site one request" no longer holds. The ceilings that make
that acceptable are the ones already here — the per-rider bucket bounds what
one rider can aim anywhere, and the entry ceiling counts entries, so per-rider
keying spends hit rate and not memory. Rides, metrics and rooms are all
room-scoped or rider-scoped by construction (WATTROOM.md's privacy rules); a
cache that let one rider read a fact about another's reading was the odd one
out, and outbound politeness is the cheaper of the two things to give up.

The share-card half of #1739 — the OG renderer's own cache and budget — landed
separately in #1750 and changed nothing here.
