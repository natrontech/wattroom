import { ShelterNoneGapM } from '$lib/protocol';
import type { RaceReadout } from './race-view';

/**
 * In the wheel or in the wind (#3265, docs/spec/races.md "Drafting"): the
 * hub's shelter as a word that holds still. In at 15 % held 1 s, out below
 * 10 % held 1.5 s, so a wheel gained and lost in a second never flickers.
 */
export const WHEEL = { in: 0.15, inHoldS: 1, out: 0.1, outHoldS: 1.5 };

export function createWheel() {
	let inWheel = false;
	// When the shelter first stood on the other side of the line, seconds.
	let since: number | null = null;
	return {
		/** This tick's shelter at `atS` seconds; whether you are in the wheel now. */
		hear(shelter: number, atS: number): boolean {
			const across = inWheel ? shelter < WHEEL.out : shelter >= WHEEL.in;
			if (!across) {
				since = null;
				return inWheel;
			}
			since ??= atS;
			if (atS - since >= (inWheel ? WHEEL.outHoldS : WHEEL.inHoldS)) {
				inWheel = !inWheel;
				since = null;
			}
			return inWheel;
		},
		/** Out of the race: the next one starts in the wind. */
		reset() {
			inWheel = false;
			since = null;
		},
	};
}

/**
 * Who went by between two ticks, close enough to hear (#3265): a racer whose
 * gap to you changed sign and is now within ShelterNoneGapM, the reach of a
 * wheel. −1 is one who passed you, 1 one you passed.
 */
export function passes(
	was: Pick<RaceReadout, 'gaps'>,
	now: Pick<RaceReadout, 'gaps'>,
): (1 | -1)[] {
	const out: (1 | -1)[] = [];
	for (const [id, after] of Object.entries(now.gaps)) {
		const before = was.gaps[id];
		if (before === undefined || Math.abs(after) >= ShelterNoneGapM) continue;
		if (before < 0 && after > 0) out.push(-1);
		else if (before > 0 && after < 0) out.push(1);
	}
	return out;
}
