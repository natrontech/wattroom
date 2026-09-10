# Audit: accessibility of the web app — 2026-09-10

**Slice.** `web/src/**` against WCAG 2.2 AA and the project's own rules, for the riders a defect locks out: keyboard-only (every interactive element reachable and operable, focus order, traps, Escape), screen-reader (names, roles, states on the custom widgets, live regions for what changes mid-ride, landmarks, titles), reduced vision (contrast of the theme tokens and their alpha variants, text at 10–11 px, colour-only signals) and motion sensitivity (`prefers-reduced-motion`).
**Excluded**: the server; the desktop shell beyond the pages it loads; tap targets, covered by ux.md's 24/44 rule and the night's earlier fixes.
**Method.** One Explore agent at `aad33b20`, read-only against ux.md, errors.md, ADR-0005, ADR-0020 and WCAG 2.2 AA; contrast ratios computed from the `@theme` hex values in `app.css` (sRGB; `color-mix(in oklab)` shifts them by about ±0.1); the two highs verified by reading the cited code before filing. No screen reader was run.

## Filed

By the rule _bug or high_; the muted-alpha contrast finding was already #1522 and got the numbers as a comment instead; four route findings turned out to be retired redirect stubs and were not filed.

| #     | Finding                                                                                                         | Severity | WCAG         | Status                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------- | -------- | ------------ | -------------------------------------------------------------------------------------- |
| #1960 | Closing a context menu drops keyboard focus to the body, not back to the object                                 | high     | 2.4.3        | fixed (#1972)                                                                          |
| #1961 | The toast's Undo is unreachable by keyboard and expires under the rider                                         | high     | 2.1.1, 2.2.1 | open                                                                                   |
| #1962 | The `@` mention list is not a real combobox                                                                     | bug      | 4.1.2        | fixed (#1972)                                                                          |
| #1963 | The soundboard's rename field is nested inside the pad button; its delete confirm takes no focus                | bug      | 4.1.2, 2.4.3 | open                                                                                   |
| #1964 | A fader inside a context menu is not a menu item                                                                | bug      | 4.1.2        | fixed (#1972)                                                                          |
| #1965 | The accent tokens are used as 10–11 px text, below 4.5:1                                                        | bug      | 1.4.3        | open                                                                                   |
| #1966 | Colour-only states get a name — presence on the avatar, a pressed reaction, the gate meter                      | bug      | 1.4.1, 4.1.2 | fixed (#1972)                                                                          |
| #1967 | A chosen day and a rejected time in the when-picker are announced                                               | bug      | 4.1.2, 3.3.1 | open                                                                                   |
| #1968 | Routes without a title or a main landmark                                                                       | bug      | 2.4.2, 1.3.1 | fixed (#1972): the messages column is a `main`; the untitled routes were retired stubs |
| #1969 | Escape closes every layer at once; the open drawer keeps no focus                                               | bug      | 3.2.2, 2.4.3 | open                                                                                   |
| #1970 | The session countdown announces nothing; the sprint klaxon re-announces every second                            | missing  | 4.1.3        | fixed (#1972)                                                                          |
| #1971 | Polish: motion-safe on the sync dots, the dead `text-scale` meta, the nav's name, arrow keys on the icon picker | low      | 2.3.3, 1.3.1 | half (#1972: the dots, the name)                                                       |
| #1522 | The muted alpha text ramp is under 4.5:1 (existing)                                                             | bug      | 1.4.3        | open — numbers added                                                                   |

## Checked and found sound

- **The focus trap** (`focus-trap.ts`) handles the portal-ordering case, wraps both ways and restores; applied to every modal surface, tested.
- **`Select.svelte`** is a correct select-only combobox — `role`, `aria-haspopup/expanded/controls/activedescendant`, the value in the trigger's name, `tabindex="-1"` on options, Escape stopped at one layer; the mention list now matches it.
- **`Instrument.svelte`** names the zone and states on-target in words, colour as the second channel — the model for a mid-ride readout.
- **Banners** are `role="alert"` for errors and `role="status"` otherwise, persistent per errors.md, with one big recovery button; **`CrewSwitcher`** carries `aria-expanded`/`aria-current` and refuses `role="menu"` for something that only tabs.
- **Charts** are `role="img"` with descriptive labels and list legends; interval blocks carry titles.
- **Reduced motion** is honoured everywhere but the two jukebox dots (now fixed); the skeleton shimmer is killed in `app.css`.
- **The skip link and the closed drawer's `inert`**; the focus ring is unlayered so it beats `outline-none` and uses `--color-ink` on both themes; the viewport allows zoom.
- **`ptt-keys.ts`** yields Space to any keyboard-focused control; **`ConfirmHost`** puts Cancel first so the trap lands on the safe answer.
- **The theme gate** (`palette.test.ts`) enforces 4.5:1 for ink and muted and 3:1 for accents across every catalogued theme — the alpha utilities are what route around it.

## Not checked

No screen reader was run (NVDA, JAWS, VoiceOver), so the `aria-label`-on-`span` and `title`-on-`div` claims are read from the specs, not heard; Lucide icons given an `aria-label` render as a named bare `<svg>` whose exposure depends on the engine; the composited contrast numbers need a browser-run `getComputedStyle` sweep to be exact; `prefers-contrast` and `forced-colors` have zero occurrences and need a Windows High Contrast device to judge; whether a screen-reader rider can ride at all (no live region for watts against target, no audio target cue) is an ADR-shaped decision, not a defect; there is no automated axe or Lighthouse coverage in `web/e2e/`.
