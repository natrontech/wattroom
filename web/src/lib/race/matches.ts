import { createWBal, type CPW } from '$lib/road/cpw';

/**
 * The matches gauge (#3263, docs/spec/races.md "Matches"): your own W′
 * balance on the RACE page as four matches, one burnt per quarter of W′
 * spent. Computed on your screen from your own seconds and never sent — a
 * model's output about you alone, so it ranks nobody.
 */
export const MATCHES = 4;

/** Matches left at this balance: none once W′ is spent, however far past. */
export function matchesLeft(balance: number, wPrime: number): number {
	const burnt = Math.floor((wPrime - balance) / (wPrime / MATCHES));
	return Math.max(0, Math.min(MATCHES, MATCHES - burnt));
}

/** What the RACE page shows: matches left, null with no model, and its one line. */
export interface MatchesReadout {
	left: number | null;
	line: string | null;
}

/**
 * The gauge's one line: with no curve to fit, the hint that hides it; with
 * the 5/20 fallback, that it is an estimate (#3262); nothing otherwise.
 */
export function matchesLine(model: CPW | null): string | null {
	if (!model) return 'Matches show once you have 5- and 20-min bests';
	return model.estimate
		? 'Matches estimated from your 5- and 20-min bests'
		: null;
}

/**
 * Your W′ balance through this session's seconds, a second at a time (Skiba,
 * $lib/road/cpw). Fed the recording each time it grows: only the new seconds
 * are stepped, and a recording that started over starts the balance over.
 */
export function createMatchGauge(model: CPW) {
	let wbal = createWBal(model);
	let fed = 0;
	return {
		/** Matches left after these seconds. */
		feed(seconds: readonly { watts: number }[]): number {
			if (seconds.length < fed) {
				wbal = createWBal(model);
				fed = 0;
			}
			for (; fed < seconds.length; fed++) wbal.step(seconds[fed].watts);
			return matchesLeft(wbal.balance, model.wPrime);
		},
	};
}
