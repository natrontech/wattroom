# Audit: navigation and first-run — 2026-09-10

**Slice.** The shell and the sidebar (the crew header, the five rows, the rooms and DM sections, the you-panel, the drawer), `/home`'s sections and empty states, the settings tree's placement of every setting against ADR-0020's sixth amendment and the 95 % rule, the rooms directory and the crew door, and first-run as a brand-new account meets it.
**Excluded** (audited already): inside a room, rides and the ride screens, messages internals, auth internals, presence internals, the HUD.
**Method.** One Explore agent at `bd8b9598`, read-only against WATTROOM.md, docs/SPEC.md, ADR-0020 and its amendments, the rules, and the earlier home audit (2026-09-09-hud-tv-home-legal); the two highs verified by reading the cited code before filing. The maintainer's taste (less, aligned, top, full width; no cards or icon strips in the sidebar) was a constraint on the fixes, not a subject.

## Filed

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| #1857 | The first-run checklist is gated on owning a crew, so the account that needs it never sees it; its first step is labelled for a fact it does not test | high | fixed (#1864) |
| #1858 | A rider cannot choose a microphone or camera anywhere until they are standing in a room | high | fixed (#1869): `deviceChoices()` is one store above the router, `/settings/voice` picks from it with no room |
| #1859 | Following the sidebar's own "Get the desktop app" row deletes the sidebar (`/download`, `/legal`, `/privacy` drop the shell) | bug | fixed (#1866): `framed` split from `publicPath` |
| #1860 | Decision: single-speed and sprint grade on Profile, Sign out under Your data, the calendar link on Home | decision | `needs-human-input` |
| #1861 | Every golden-path spec enters through the retired `/rooms` stub; the shipped door (the sidebar `+`) and the first-run card have no test | test | fixed (#1868) — and taking the door found the sheet standing over the room it had just opened, fixed in the same PR |
| #1862 | Polish: `/sessions` lands on Home's top, duplicate form ids, no rides empty state, the new-account notice waits for Home, ADR-0020's tree lacks two rows | low | fixed (#1864) |
| #1863 | Decision: `/rooms/directory` and `/messages` are pages with no row to light | decision | `needs-human-input` |

Cited rather than re-filed: #1693 (What's next), #1484 (the FTP 200 W / 75 kg default on Home's stat band), #1828 (the ride-mail switch), #1667 (`/whats-new` parentless), #1493 (the calendar reset's confirm).

## The settings map

Every setting, where it lives, where a rider would look, and default-or-setting by the 95 % rule — the agent's table is reproduced in #1860 for the three placements it questions; the rest were found where a rider would look. Two are defaults dressed as settings and belong under an Advanced fold at most: **sprint grade** (one number, 5 %, already behind the single-speed checkbox) and **duck yourself too**. Sign out is the one row on the tree that is not a setting.

## Checked and found sound

- **The sidebar matches the tree it was drawn from** — row order, labels and nesting are ADR-0020's sixth amendment line for line; names, not an icon rail; no cards; full-width rows on a 16 px edge.
- **`activePlace` and `activeHref`** — longest match keeps `/training` off the Lounge, `covers` keeps Workouts lit under `/ride` and `/ramp`, a slug that reads like a place resolves to the Lounge; tested.
- **The pin survives a crew switch**, and `currentCrew` never blanks the column on a stale localStorage id; tested.
- **Nothing lives only in a menu** — the crew page is a link on the header, a room's places are rows and menu entries, an unjoined room offers one entry rather than five that would 403.
- **The crew door** draws four states before the button and says what joining discloses; `crew-invite.spec.ts` walks gate → door → crew → room → member re-read end to end.
- **`/rooms/directory` has all four states** plus a separate error slot for the second page, and discloses name and icon only.
- **Home's error handling** — one banner, one Retry, re-running whichever read failed; neither failure can masquerade as an empty list.
- **Friends teaches its own formation rule** with the add-by-code row above the list.
- **Phone width covers the slice** — every route here is in `phone-width.spec.ts` with seeding that stops the assertion going green on nothing.
- **The drawer below md** — inert when closed, focus in on open and back on close, Escape, navigation closes it, the FAB in the thumb zone once the cave takes the top bar.
- **The skip link, the shell holding the frame while `/api/me` answers, `/settings`'s six sections in the amendment's order, and the retired destinations staying retired** (no code in `web/src` navigates to them — only the suite, which is #1861).

## Not checked

- Whether the `#sessions` hash would have scrolled in this shell — fixed by the list-aware effect rather than observed.
- Whether the duplicate ids actually misdirected focus — fixed by naming rather than observed.
- What a signed-in rider sees during a cold `/c/{code}` load, whether `/profile`, `/pair` and `/trophies` got their one-release grace, anything needing two live riders or a real device tree, and the server-side room/crew authorisation model.
