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
