# UX

The rider is on a bike, sweating, the screen at arm's length or three metres away. Design for that first, the desk second.

Every surface has a target and a must-match list in [docs/design/TARGETS.md](../../docs/design/TARGETS.md). A rider-visible PR is marked ready only after a passing design check ([DESIGN-CHECK.md](../../docs/design/DESIGN-CHECK.md)).

## Defaults

If 95 % of riders would pick the same value, it is a default, not a setting; edge cases get a collapsed Advanced expander at most. Decided defaults live in docs/SPEC.md.

## Mid-ride

- Huge tap targets, no precision gestures, no typing.
- State changes announce themselves with sound and a visual.
- Errors are persistent status; recovery is automatic where possible and otherwise one big button.

## Surfaces

- Empty states teach: one line on what the thing is, plus the CTA that makes the first one ("Start your crew").
- Data (watts, graphs) glows; chrome stays quiet. `--color-watt` is live data only.
- A feature whose precondition is absent (no trainer, LiveKit down, not embeddable) is disabled with a one-line hint or hidden. It never fails on click.
- Words come from the SPEC glossary: crew, text channel, voice channel, session, coach, sprint moments. Never "room" ([ADR-0058](../../docs/decisions/0058-the-room-dissolves-into-the-crew.md)), and no per-screen synonyms.
- Copy says what a thing is or does, never what it isn't. No reassurance by negation ("your private space, and no one else's", "nothing leaves this device", "no one sees this but you"). Name what doesn't happen only when the rider needs that fact to decide, and then say it once, in a few words.

## Phone width: 375 × 812

Every surface outside a session, including history, settings, workouts and profile.

- The page body scrolls down, never sideways; wide content gets its own `overflow-x: auto`. `e2e/phone-width.spec.ts` measures `[data-testid=page-body]` on every route in `e2e/routes.ts`. A new route is measured or excluded there with a reason, or `e2e/routes.test.ts` fails.
- Measure the page body, never `documentElement.scrollWidth`.
- An SVG measured with `bind:clientWidth` gets `width="100%"` and a `viewBox`, never a pixel width; any floor stays below the narrowest real column.
- Primary work stacks first on a phone, before any sidebar. The workout editor never stacks library-first.
- Tap targets: 24 px minimum (WCAG 2.5.8), 44 px for controls used while pedalling (2.5.5). `btn-lg` is 44, `btn` 36–38, `btn-xs` 28–30, `btn-link` 16 (inline text, exempt). Use `btn-lg` mid-ride, not everywhere.
- The last item clears the browser chrome.

## Keyboard focus

- Opening a text-first task (a text channel, a private conversation, or switching between them) focuses its input.
- Focus follows deliberate navigation, never incoming messages, polling or background renders. Keep focus when the rider picks another control or opens a dialog; don't scroll as a side effect of focusing.

## Motion ([ADR-0079](../../docs/decisions/0079-motion-announces-the-camera-stays-still.md))

- Live numbers snap. A bar settles through `transform` over `--dur-live`; only a result rolls, and only once.
- Juice goes on things, never on the screen: a chip, a flag, a bell, confetti from a hand. No shake, bob, roll, overshoot, blur or speed lines where a rider pedals.
- One stage moment at a time, through the moments queue; every motion names its cue and its hit time.
- A cue exists only where its model exists: no draft wake without draft physics.
- Reduced motion keeps every sound and turns each motion into a held stamp. The world follows the per-device World control; the rest of the app follows the OS setting.
- Flashes: at most WCAG 2.3.1 (one luminance flash per 10 s over 25 % of a 10° field). `--color-z6`, `--color-z7`, `--color-danger` and `--color-watt` never blink.
- Durations and easings come from the motion tokens (docs/SPEC.md, "Motion"), never literals.

## Right-click

- An object with more than one action (a sidebar channel, a rider's tile, a queued track, the stage, a message) gets a context menu (`contextMenu` from `$lib/context-menu.svelte`, drawn by `ContextMenuHost`): right-click on a desk, long-press on touch.
- The primary action stays on click. A menu item is a shortcut, never the only way.
- Items say what happens ("Leave the crew", "Remove"); destructive ones take the danger token and sit last, after a separator.
