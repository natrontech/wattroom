/**
 * Whether to believe the roster's `away`, or to hold what this screen just
 * pressed (#1128).
 *
 * Pressing Away is optimistic — local state first, message second — so the
 * tick ALREADY IN FLIGHT still carries the old value. Applying it ran the
 * come-back branch a fifth of a second later: the mix unmuted and the mic
 * re-opened itself, and the button read as doing nothing while the room went
 * on hearing the rider.
 *
 * Pure, and its own module, because the effect that calls it lives inside a
 * connection whose AV stack cannot be stood up in a test environment — the
 * wiring test for this spent ten seconds a run on CI and five milliseconds
 * locally, which measures the harness rather than the rule. The rule is here
 * and the effect is two lines.
 */
export interface AwayEcho {
	/** What this screen pressed and has not seen echoed; null = believe the roster. */
	wanted: boolean | null;
	/** Disagreeing ticks seen since the press. */
	waited: number;
}

/**
 * How many disagreeing ticks to tolerate before believing the roster again —
 * the bound on waiting for a server that may never have received the press.
 *
 * TICKS, not milliseconds. Ticks are what actually arrive; a wall clock
 * measures how busy the machine is, and a five-second version of this expired
 * inside one CI run while passing locally three times.
 */
export const AWAY_ECHO_TICKS = 5;

export const noEcho: AwayEcho = { wanted: null, waited: 0 };

/** What a press starts waiting for. */
export function pressed(next: boolean): AwayEcho {
	return { wanted: next, waited: 0 };
}

/**
 * Given the roster's value and what this screen is waiting for, say whether
 * to apply it and what to wait for next.
 */
export function applyAway(
	server: boolean,
	echo: AwayEcho,
	limit = AWAY_ECHO_TICKS,
): { apply: boolean; echo: AwayEcho } {
	if (echo.wanted === null) return { apply: true, echo };
	if (server === echo.wanted) return { apply: true, echo: noEcho };
	const waited = echo.waited + 1;
	// Given up: the server clearly never heard the press, and a screen pinned
	// to a wish forever is worse than one that loses it. This is also how a
	// dropped socket heals on reconnect.
	if (waited > limit) return { apply: true, echo: noEcho };
	return { apply: false, echo: { wanted: echo.wanted, waited } };
}
