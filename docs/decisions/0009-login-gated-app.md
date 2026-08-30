# ADR-0009: Everything behind sign-in

Date: 2026-08-30 · Status: accepted (amended 2026-08-30: `/` public)

## Context

M1 shipped an account-free solo player (rides in localStorage/IndexedDB,
custom workouts in localStorage); accounts arrived with M2 for rooms. The
resulting hybrid meant a signed-out solo ride created a second history that
never merged into stats, streaks, XP or medals, and every screen carried a
signed-out empty state. Every comparable trainer app (Zwift, TrainerRoad,
MyWhoosh) gates everything.

## Decision

The whole app sits behind sign-in. A designed `/login` screen (OAuth
providers from `/api/auth/providers`, no passwords — WATTROOM.md auth
decision unchanged) is the only app route a signed-out visitor sees; deep
links survive via `?next=` (same-origin paths only). `/dev` mocks stay open
in dev builds — they are 404 in production already.

**Amendment (#111):** `/` is public. Signed out it renders the marketing
landing — the public face of wattroom.ch — and signed in it stays the app
shell; the page branches, the gate covers everything else. Room share
links (`/r/<slug>`) still route through /login with the deep link kept.

Consequences accepted:

- **No local-only mode.** A server with zero providers configured shows a
  capability hint on /login instead of a usable app. Dev uses the dev
  provider; production requires the OAuth apps registered (#34 et al.).
- **Spectating requires an account.** The watch page's WS was already
  membership-gated, so nothing was actually lost.
- **Solo rides become account rides** (#110): server-side save with
  `room_id` null, one history. IndexedDB demotes to crash recovery only.
- Local custom workouts stay local for now — behind the gate either way.

## Alternatives rejected

- Hybrid with a nicer login screen: keeps the two-histories problem.
- Public demo player: a funnel for a product whose users arrive by invite
  link; unjustified surface area.
