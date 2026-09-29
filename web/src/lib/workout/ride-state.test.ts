import { describe, expect, it } from 'vitest';
import { SIGNAL_LOST_MS, signalLost } from './ride-state';

describe('signalLost (#2158)', () => {
	const riding = { state: 'running' as const, sample: null };
	const started = 1_000;

	it('says so when a trainer never sends a first sample at all', () => {
		// The case the old rule could not see: a trainer that streams frames
		// with no power field delivers no sample, so `sample && …` was false
		// for the whole ride. /ramp ran its full length that way.
		expect(signalLost(riding, started, started + SIGNAL_LOST_MS + 1)).toBe(
			true,
		);
		expect(signalLost(riding, started, started + SIGNAL_LOST_MS - 1)).toBe(
			false,
		);
	});

	it('counts from the last sample once there is one', () => {
		const sampled = { state: 'running' as const, sample: { at: 5_000 } };
		expect(signalLost(sampled, started, 5_000 + SIGNAL_LOST_MS + 1)).toBe(true);
		expect(signalLost(sampled, started, 5_000 + SIGNAL_LOST_MS - 1)).toBe(
			false,
		);
	});

	it('is quiet before the clock starts, and once the ride is done', () => {
		// ridingSince is stamped when the CLOCK starts (#1800), so the
		// count-in is not a gap in the trainer's reporting. `undefined` is
		// "not started" — 0 is a timestamp, and an injected clock starts there.
		expect(signalLost(riding, undefined, started + 10 * SIGNAL_LOST_MS)).toBe(
			false,
		);
		expect(signalLost(riding, 0, SIGNAL_LOST_MS + 1)).toBe(true);
		expect(
			signalLost(
				{ state: 'countdown', sample: null },
				started,
				started + 10 * SIGNAL_LOST_MS,
			),
		).toBe(false);
		expect(
			signalLost(
				{ state: 'done', sample: null },
				started,
				started + 10 * SIGNAL_LOST_MS,
			),
		).toBe(false);
		expect(signalLost(null, started, started + 10 * SIGNAL_LOST_MS)).toBe(
			false,
		);
	});
});
