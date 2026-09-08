# UX conventions

WattRoom's user is on a bike, sweating, screen at arm's length or across the room. Every UI decision optimizes for that first, desk-comfort second.

## The 95% rule

Before adding any setting/toggle: would 95% of riders pick the same value? Then it's a default, not a setting (put edge-case needs in a collapsed Advanced expander at most). Defaults already decided this way live in docs/SPEC.md — voice/camera available by default, sensible tolerances, auto-pause on.

## Mid-ride interaction rules

- Anything usable during a ride: huge tap targets, no precision gestures, no typing.
- State changes announce themselves (sound + visual) — riders don't watch the screen continuously.
- Errors during a ride are persistent dashboard status, never transient toasts; recovery is automatic wherever possible (reconnects), manual recovery is one big button.

## Surfaces

- Empty states teach, never apologize: one line on what the thing is + the CTA that creates the first one ("Open your first room"). It's the only onboarding most users read.
- Data (watts, graphs) gets the glow; chrome stays quiet. `--color-watt` = live data only.
- Capability gating: features needing an absent precondition (no trainer paired, LiveKit down, not embeddable) render disabled with a one-line hint, or hide — never fail on click.
- Vocabulary is docs/SPEC.md's glossary — rooms, coach, session, sprint moments. Don't invent synonyms per screen.

## Phone width

The standard is **375 × 812**, and it applies to every surface outside a room. WATTROOM.md makes a phone a spectator *in a room*; it says nothing about `/history`, `/profile`, `/workouts` or `/pair`, and a rider checking last night's ride on the sofa is a supported use.

- **The page body scrolls down, never sideways.** Wide content — a chart, a table, a long row — wraps itself in its own `overflow-x: auto`. `e2e/phone-width.spec.ts` asserts this on `[data-testid=page-body]` for every route.
- **Never put a pixel width on an SVG you also measure.** `width={W}` beside `bind:clientWidth` props open the very container it measures, so the chart latches at its widest and never comes back down — a 600px initial `$state` stayed 600 on a 375px phone. Use `width="100%"` with the `viewBox`, and keep any floor below the narrowest real column (#1008).
- **Do not assert `documentElement.scrollWidth <= clientWidth`.** The shell's `overflow-hidden` columns absorb it: a chart 307px too wide left the document at exactly 375 and the check green. Measure the page body.
- **Stacking order is a decision.** Source order puts sidebars first; on a phone the primary work comes first. The workout editor must not stack library-first.
- **Tap targets: 24px is the floor, 44px is for riding.** WCAG 2.2 SC 2.5.8 (AA) requires 24×24 CSS px; the 44×44 in SC 2.5.5 is **AAA**, and it is the number the mid-ride rule above is really about — a sweating rider at arm's length, not someone on a sofa. Measured at 375px, the kit gives: `btn-lg` **44**, plain `btn` 36–38, `btn-xs` 28–30, `btn-link` 16 (inline text, an explicit SC 2.5.8 exception). So `btn-xs` is conformant on a browse surface and `btn-lg` is the variant that clears the enhanced bar — reach for it on controls a rider uses **while pedalling**, not everywhere. Stating a flat 44 here was wrong: it condemned every button in the app including the default one, which is how a rule gets ignored rather than followed (#1088).
- The last item must clear the browser chrome.

## Keyboard focus

- Opening a text-first task, such as a room chat or private conversation, puts focus in its primary input after navigation so typing works immediately. Apply this when switching conversations too.
- Focus follows deliberate navigation, never incoming messages, polling, or background renders. Preserve focus when the rider chooses another control or opens a dialog, and avoid incidental scrolling when focusing.

## Right-click

- Every object with more than one action gets a context menu (`contextMenu` from `$lib/context-menu.svelte`, drawn by `ContextMenuHost`): a room in the sidebar, a rider's tile, a track in the queue, the stage, a message. Right-click on a desk, long-press on touch.
- The primary action stays on click; the menu holds the rest. Nothing lives *only* in a menu — it is a shortcut, never the sole way, so mid-ride targets stay huge and discoverable.
- Items say what happens ("Leave the room", "Remove"); destructive ones take the danger token and sit last after a separator.
