# Audit: the HUD, TV mode, home, what's new and the legal pages (2026-09-09)

**Slice.** The surfaces nobody had audited: `/hud` and the desktop shell's floating window (ADR-0041), TV/watch mode (`TvOverlay`, `TvMode`, `/r/[slug]/watch`), `/home` and the root page, `/whats-new` and where its content comes from, and the legal group (`/legal`, `/privacy`, `/download`).

**Excluded.** The riding screen itself, the room places, rooms' server code, auth, mail, friends, crews, the jukebox, Strava. Open decisions cited, not re-decided: #1297, #1172/#621, #613/#1175.

**Method.** One read-only Explore agent at `a1f869e3`+ against WATTROOM.md (privacy row, RMF constraints, licence), ADR-0041, ADR-0037, ADR-0020, ADR-0005, ADR-0019 and the rules. The two highs were verified by reading the cited code before filing; the fix was checked with a unit test that mocks the feed and asserts the fault.

## Findings and where they went

| # | Finding | Kind | Disposition |
|---|---|---|---|
| 1 | The HUD feed was published by the Training place and the riding screen, while the shell opened the window on the phase: walk to Chat mid-session and it said "Waiting for a ride…" | bug, high | #1665 → **#1678** (published from the room shell and the solo session store) |
| 2 | The snapshot carried no fault: a dropped trainer or socket showed a confident glowing 0 | bug, high | #1665 → **#1678** (`fault: 'trainer' \| 'room'`) |
| 3 | The floating HUD sits top-right, exactly where TV mode seats the YouTube player, behind the front window | decision (RMF) | #1669 (`needs-human-input`) |
| 4 | The privacy page names one of four mails (not the confirmation or the unconditional security alerts) | privacy/drift | #1668 |
| 5 | The privacy page says nothing about what friends and room-mates see | privacy/drift | #1668 |
| 6 | No terms of service; no third-party notices for what the SPA bundles (OFL fonts, Lucide, LiveKit, Svelte, Tailwind) | not-built / decision | #1670 (`needs-human-input`) |
| 7 | TV mode opened only from the Lounge | polish | #1667 → **#1678** (button on the Training header) |
| 8 | Home's "this week" tile said 0 rides while `/api/rides` was in flight | bug | #1666 → **#1678** |
| 9 | A missing `changelog.md` read as "this build predates the first release" (the SPA fallback is 200 + HTML) | bug, low | #1667 → **#1678** |
| 10 | What's new has no permanent way in beyond the home notice and the Settings footer | drift, low | #1667 (left as is: the sidebar stays lean) |
| 11 | A signed-out HUD window redirected to a login page in a 320 px box | bug, low | #1667 → **#1678** |
| 12 | `/` signed out and `/hud` are outside the phone-width sweep | tests | #1667 (open: `/hud` has no page body to measure; `/` needs a signed-out fixture) |

## Checked and found sound

- **HUD privacy.** The snapshot is four of the rider's own numbers and a label, nothing about anyone else, and reads no sensor (ADR-0025 untouched).
- **HUD staleness and chrome.** Two missed ticks → "Waiting for a ride…", unit- and end-to-end-tested; frameless drag surface with a labelled close; the layout keeps it outside the frame; the shell guards its navigation and closes it with the main window; idempotent open in `desktop/smoke.spec.js`.
- **TV mode and RMF inside the page.** The player seat is ≥240×200 with an explicit min-height; the dock outranks the overlay so the sprint and game layers pass under the video; TV mode is a dialog with a focus trap, a visible "Exit TV mode (esc)" and a one-layer Escape chain; with no session it draws the lounge without glowing zeros; others' rows show name and watts only, never HR; `RoomStatus` sits clear of the player seat; `/r/[slug]/watch` is a deliberate redirect with a held frame.
- **Root and home states.** Held-not-blank while `/api/me` answers; four distinct empty states for a new account; "Open a room" as a `btn-lg` before the first room; reduced motion handled where the animation is.
- **Changelog provenance.** Hand-written per PR, collated by `scripts/release.sh`, staged by the Makefile and the Dockerfile so the page always describes the running build; `web/static/changelog.md` gitignored and current through the latest tag; the "new since you last looked" logic and the duplicate-key regression are tested.
- **Legal pages** render signed-out and at 375 px; the licence named matches WATTROOM.md; the cookie section matches the two cookies the server sets; the HR paragraph and the Art. 9(2)(a) basis match ADR-0008; the Strava statement matches the migration default and RESEARCH §13.5.

## Decisions surfaced

Terms of service (a, b or c in #1670); the hosting provider sentence (#1297, the page is ready for it); the HUD over the player (#1669: reposition, hide while media plays, or amend ADR-0041); the theme gate on the public pages (folded into #1172).
