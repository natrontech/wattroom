import type { Clamp } from '$lib/ride/drivetrain';

/** docs/SPEC.md "At the limit" (defaults — tune in alpha). */
export const LIMIT = { showAfterMs: 3_000, clearAfterMs: 3_000 } as const;

/**
 * What the limit line says. A lower gear brings a clamped write back into
 * range at either end, so the advice is the same; at the ceiling a cassette
 * rider also has a real gear to reach for.
 */
export function limitLine(clamp: Clamp, cassette: boolean): string {
	return clamp === 'grade-max' && cassette
		? 'Your trainer is at its limit in this gear — shift easier, or move your chain to a smaller cog.'
		: 'Your trainer is at its limit in this gear — shift easier.';
}

/**
 * Whether the limit line shows (#3330): after 3 s clamped, and gone after
 * 3 s clear. Persistent status, never a toast (errors.md) — and never a line
 * that blinks with terrain that brushes the limit.
 */
export function createLimitWatch(delays: typeof LIMIT = LIMIT) {
	let showing = false;
	let since: number | null = null;
	return {
		see(clamped: boolean, at: number): boolean {
			if (clamped === showing) {
				since = null;
				return showing;
			}
			since ??= at;
			const wait = clamped ? delays.showAfterMs : delays.clearAfterMs;
			if (at - since >= wait) {
				showing = clamped;
				since = null;
			}
			return showing;
		},
	};
}
