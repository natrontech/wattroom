# Audit 2026-09-16 — UI/UX sweep, every route, desktop and phone

**Slice.** The whole SvelteKit app under `web/src`: every route, at desktop
width and at 375×812, light and dark. Six read-only code auditors, one per
area (shell and kit; entry and crews; room places; riding surfaces; account
and settings; social), plus a browser pass of every reachable route in the dev
app signed in as a rider with two rooms, a crew of two, a planned session, a
ride, a chat line, a friend and a DM. Commit `8982c3ca`.

**Excluded.** Server correctness, BLE and trainer hardware, the desktop shell's
native chrome, the `/dev/*` mock pages, and the mid-ride dashboard with a live
trainer (read from code only). Voice, camera and the Sound panel on a phone are
in flight as #2143 and were not re-reported.

**Filing rule.** Every `bug`, and every finding of medium or high severity, got
its own issue. Low-severity findings went into one bundle per area so an agent
can take an area in one PR. One finding is a decision and carries
`needs-human-input`. Everything below was read at its `path:line`; items marked
*verified* were reproduced in the running app.

## Filed

High:

- #2153 a toast or dialog raised from the phone drawer's own menus paints under the drawer — *verified* (adjacent: #2143 covers the Modal half)
- #2154 handing the crew over and banning live only in a right-click menu on the people list — *verified* (same shape #1372 fixed on Members)
- #2155 renaming a passkey opens `window.prompt`, which the desktop shell does not implement
- #2156 TV mode on a solo ride or the ramp hides every ride-critical status
- #2157 a reply refused from an OS notification is told to a window nobody is looking at

Medium:

- #2158 the ramp's dropout banner waits for a first sample; its pairing card skips the no-power hint
- #2159 the HUD's on-target test drops SPEC's ±10 W floor
- #2160 the crew strip prints "0 bpm" for every rider without a strap
- #2162 a member can open a room playlist's rename box and the save is refused
- #2163 a refused room-preference save snaps a saved switch back to a stale snapshot
- #2164 the room's Settings place nests a `main` inside the shell's — *verified*
- #2165 the profile form drops unsaved edits on any account refresh; the Strava toggle commits the form
- #2166 four of five profile field errors never reach their field; a failed picture upload reads like "Saved."
- #2167 the share toggle names the action on the list and the state on the ride page
- #2168 Home says "riding now" for a friend who is only in a room (regression of #1653)
- #2169 the sidebar's DM row offers "Add friend" to a friend
- #2170 the friends row's message link is 15 px; composer icon buttons retyped — *verified*
- #2171 the phone's conversation list and Home's recent rides carry no context menu where their twins do
- #2172 three friend row shapes; the rider page can accept but not dismiss or withdraw
- #2173 the sidebar says "Not in a crew yet" before the room list lands and when the first read fails
- #2174 numerals are set in `font-mono`, which the theme never defines — decide once
- #2175 the crew header cannot fit its name beside "Make main crew" and "Settings" at 375 px
- #2176 "Join a crew", the sheet's join-first order and the dialog's name are gated on three different things
- #2177 a crew room row's reach button names the opposite step with no verb — *verified*

Bundles (low):

- #2161 riding: the room's mid-ride TV button at 28 px, the ramp under the phone FAB, `/ride` padding, two silence thresholds
- #2178 kit: retyped chrome, unicode arrows in the editor, a Modal with no height cap, white-on-lilac selection, the licences page's own states
- #2179 room places: 21 px layout buttons, a misplaced error, two "Move" buttons, "crew" for the room's riders, a duplicated streak, FaultBanner as status, a hover-only remove, the Sessions rows at 375 — *last item verified*
- #2180 refactor: clipboard copies, the room ban, the `Room` type, the flag button, message and code bounds
- #2181 settings: checkboxes that stay flipped, three promises about the address, a neutral toast for a refused delete, a chart inside the FTP label, export copy from before the zip, a default dressed as a setting
- #2182 social: a sticky red line, a code copy that never reports failure, a rail name resolved by display name, a name that cannot truncate
- #2183 entry: the door's refusal style, stale crew comments, "1 blocks", the workouts search row and the rider page header at 375 — *last three verified*

Decision:

- #2184 the landing promises "Open your first room" while day one now leads with joining a crew — `needs-human-input`

Folded into existing issues: `/u/{id}` of another rider lights no sidebar row →
#1863. Notes left on #2143, #1653 and #1372.

Not filed: the ramp's save omits `bias`/`clock`/`released` that `/ride` sends
(`ramp/+page.svelte:277-281` vs `ride/+page.svelte:270-283`) — no rider-visible
effect while the ramp is `unscored`; the one save path that will drift if that
changes.

## Checked and found sound

Browser pass, every route listed in `web/src/routes` that a signed-in rider can
reach, at the pane's desktop width and at 375×812:

- **No page body scrolls sideways** at 375 px (`scrollWidth === clientWidth`
  on `page-body`/`place-body` for Home, Workouts, the editor, Rides, a ride,
  Friends, Messages and a DM, Music, the crew page and its settings, the Lounge,
  Chat, Sessions, Room settings, Training, the six settings pages, a rider page,
  `/ride`, `/ramp`, the directory, What's new, the landing, the sign-in gate).
- **Retired routes redirect** (`/sessions` → Home, `/progression` → Rides,
  `/rooms` → directory/Home, `/watch` → the Lounge).
- **Focus lands in the composer** on the room chat, the DM thread and the
  read-from-outside room thread after navigation.
- **Dark scheme** renders Home, the Lounge, the editor and Appearance with every
  token paired; the login cave stays dark in both.
- **The sign-in gate names the crew** behind an invite link at 375 px; the
  landing holds at 375 px with its live scene.
- **`btn-accent` on "Start a session" / "Join them"** is ADR-0005's one chrome
  exception (`app.css:188-192`, border only) — not a token violation.
- **Empty states teach** on Workouts, Music, the directory, Messages, Members,
  Sessions and the crew's rooms.

From the six code auditors, the lists they checked and found fine are long and
specific; the ones that settle questions an earlier audit left open:

- Shell: the frame holds while `/api/me` answers; the drawer is `inert` when
  closed, returns focus, closes on navigation; context menus return focus and
  walk with arrows; toasts hold under pointer and focus; every route has a
  `main` landmark; every colour is a `light-dark()` pair; the focus ring beats
  `outline-none`.
- Entry and crews: four states on the crew page, its settings, the door, the
  directory, Home, sign-in and recovery; the door discloses nothing to a
  stranger; leave and hand-over confirm with the breakage named; the switcher's
  main-crew entry appears only with a choice to make.
- Room places: four states inside and outside the room; ban with undo, remove
  and transfer with confirm; the reach ladder shared with the crew page; PTT
  hidden without a key; the people sheet is a real dialog; `mobile-room.spec.ts`
  measures every place at 375.
- Riding: one count-in shared by room, `/ride` and `/ramp`; `RideStatus` is
  persistent status with the re-pair button; every mid-ride control on the
  solo screens is `btn-lg`; no measured pixel width on any chart; the save path
  is persistent status, never a toast, until the page is gone.
- Account: purge names rooms and crews and refuses to say "removed" on failure;
  the calendar reset and coach-token revoke confirm with the way back; charts
  are `width="100%"` + `viewBox`; the address gate polls while a link is out.
- Social: the DM composer focuses on navigation never on a poll; four states on
  every list; presence words come from one vocabulary; the flag button is one
  tap with persistent error status; every social button on the rider page is
  gated on the friendship state.

## Not checked

- A live ride with a trainer, a game mode in progress, TV mode with people in
  it, and the HUD with data — read from code only.
- Voice, camera and screen share end to end (#2143 owns the phone half).
- Real tap-target pixels beyond the ones measured (friends row, workouts search).
- Light/dark contrast numerically; the theme gate has the numbers (#403).
- The desktop shell's own chrome and the macOS reply path (needs a signed build).
- `/dev/*`.

## Method notes

The browser pane drops its session cookie every couple of minutes; each batch
of routes re-signed in through `/api/auth/dev/start?as=` and moved between
routes with injected same-origin links so the SPA stayed warm. A link into
`/r/{slug}` reloads the document (the room shell is its own chunk), so probes
were inlined rather than kept on `window`. The sweep rider and a second rider
were built through the API in one script; names must be letters and spaces
only or the dev sign-in collapses them into "Dev Rider".
