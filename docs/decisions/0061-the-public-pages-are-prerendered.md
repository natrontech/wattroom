# 0061 — The public pages are prerendered; the app stays a SPA

- Status: accepted
- Date: 2026-09-26
- Answers: [#2993](https://github.com/natrontech/wattroom/issues/2993)
- Keeps: WATTROOM.md's Stack row ("SvelteKit SPA") for everything behind
  sign-in, and [0009](0009-login-gated-app.md)'s gate

## Context

Every route ran with `ssr = false`, so the HTML `https://wattroom.ch/` served
was 5 KB of head and a boot frame: the landing's words existed only after the
bundle ran. Measured on 2026-09-26:

- Googlebot renders script, after a queue. Most other readers do not: the AI
  search crawlers (OAI-SearchBot, ChatGPT-User, Claude-SearchBot,
  PerplexityBot) and link unfurlers read the served HTML and nothing else. To
  them WattRoom was a title and a meta description.
- The landing loaded the whole app shell (about 170 KB gzipped), then waited
  on `/api/me`, before it could draw a word.
- Every path answered 200 with the same shell, `/sitemap.xml`, `/favicon.ico`
  and a typo included: soft 404s, which search counts against a site.
- One screen of about 50 words is nothing to rank for, and keyword pages
  rendered the same way would have been the same empty shell.

## Decision

**Two route groups under one minimal root layout.** `(app)` holds everything
that existed: `ssr = false`, the shell's layout, served by the Go server's
fallback page, now named `spa.html`. `(site)` holds the public pages:
`prerender = true`, written out as HTML at build time and hydrated afterwards.
The root layout carries only what both need (the stylesheet and the fonts), and
it renders at build time, so nothing in it may touch the browser.

**The server serves a prerendered page for its path** (`/` is `index.html`,
`/x` is `x.html`) as the build wrote it, head included, and splices og meta
only into the fallback. A path no route answers gets the fallback with a
**404**. The list of first segments it checks is written by hand and held to
the route tree by a test.

**"/" is the landing for a stranger only.** A request carrying a session
cookie is sent to `/enter`, an `(app)` route whose shell does what it used to
do on "/": pick up the stashed deep link, the crew the rider was invited to,
the crew the sidebar opens in, else Home. The OAuth callback still lands on
"/"; the redirect carries its query. The check is the cookie's presence, not
its validity: a stale cookie costs one hop back to the landing, where a
database read would cost every stranger one.

**The public pages name wattroom.ch** in their canonical URLs, sitemap and
structured data, in every build, a self-hoster's included. The words are the
project's, and a copy on another host should point search back at the
original rather than compete with it. The app's routes keep the host-aware
meta the server writes.

## Consequences

- A crawler, a link preview and a slow phone get the words in the first
  response, and the landing draws before any script runs.
- Code under `(site)` must render without a browser. The build fails loudly
  when it does not, in CI's `web` job.
- The public pages do not share the app's shell. A signed-in rider who opens
  one sees the public chrome, which is what they asked for.
- The legal pages and `/download` stay in `(app)` for now: a signed-in rider
  reads them inside the shell (#1859), which a prerendered page cannot do.
