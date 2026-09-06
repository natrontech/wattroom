import { describe, expect, it } from 'vitest';
import { createPersonalGuards, DEFAULTS } from './guards';

const stopped = { watts: 0, cadence: 0 };
const riding = { watts: 200, cadence: 90 };
/** Turning the pedals, but collapsing under the target. */
const grinding = { watts: 120, cadence: 40 };

describe('createPersonalGuards', () => {
	it('auto-pauses after the rider stops, and releases the target', () => {
		const guards = createPersonalGuards();
		for (let i = 0; i < DEFAULTS.pauseAfterSeconds - 1; i++) {
			expect(guards.sample(stopped, 200)).toBe(false);
			expect(guards.released).toBe(false);
		}
		expect(guards.sample(stopped, 200)).toBe(true);
		expect(guards.phase).toBe('autopaused');
		expect(guards.released).toBe(true);
	});

	it('counts down before resuming rather than snapping back', () => {
		const guards = createPersonalGuards();
		for (let i = 0; i < DEFAULTS.pauseAfterSeconds; i++)
			guards.sample(stopped, 200);
		guards.sample(riding, 200);
		expect(guards.phase).toBe('resuming');
		expect(guards.resumeIn).toBe(DEFAULTS.resumeCountdown);
		// Resuming is not released: the target is back on screen while only the
		// trainer waits out the countdown.
		expect(guards.released).toBe(false);
		for (let i = 0; i < DEFAULTS.resumeCountdown - 1; i++)
			expect(guards.tick()).toBe(false);
		expect(guards.tick()).toBe(true);
		expect(guards.phase).toBe('running');
	});

	it('releases the target when cadence collapses under it', () => {
		const guards = createPersonalGuards();
		for (let i = 0; i < DEFAULTS.spiralAfterSeconds - 1; i++)
			expect(guards.sample(grinding, 200)).toBe(false);
		expect(guards.sample(grinding, 200)).toBe(true);
		expect(guards.spiralActive).toBe(true);
		expect(guards.released).toBe(true);
		// ...and takes it back once the release window runs out.
		for (let i = 0; i < DEFAULTS.spiralReleaseSeconds - 1; i++)
			expect(guards.tick()).toBe(false);
		expect(guards.tick()).toBe(true);
		expect(guards.released).toBe(false);
	});

	it('falls back to power when the trainer reports no cadence at all', () => {
		// A Kickr v2 reports none (RESEARCH.md §9); keying on cadence alone
		// would hold every one of those riders in the guard forever.
		const guards = createPersonalGuards();
		const noCadence = { watts: 60, cadence: 0 };
		for (let i = 0; i < DEFAULTS.spiralAfterSeconds; i++)
			guards.sample(noCadence, 200);
		expect(guards.released).toBe(true);
	});

	it('leaves a rider alone when there is no target to collapse under', () => {
		const guards = createPersonalGuards();
		for (let i = 0; i < DEFAULTS.spiralAfterSeconds * 2; i++)
			guards.sample(grinding, 0);
		expect(guards.released).toBe(false);
	});
});
