import { describe, expect, it } from 'vitest';
import { createLimitWatch, LIMIT, limitLine } from './limit-line';

describe('the limit line (#3330)', () => {
	/** One look a second at a clamp that follows `pattern`, repeating. */
	function watch(pattern: boolean[], seconds: number, delays = LIMIT) {
		const limit = createLimitWatch(delays);
		const shown: boolean[] = [];
		for (let s = 0; s <= seconds; s++)
			shown.push(limit.see(pattern[s % pattern.length], s * 1000));
		return shown;
	}

	it('never shows for a clamp that flickers at 1 Hz', () => {
		expect(watch([true, false], 120)).not.toContain(true);
	});

	it('shows after 3 s clamped and goes after 3 s clear', () => {
		const limit = createLimitWatch();
		expect(limit.see(true, 0)).toBe(false);
		expect(limit.see(true, 2_000)).toBe(false);
		expect(limit.see(true, 3_000)).toBe(true);
		expect(limit.see(false, 4_000)).toBe(true);
		expect(limit.see(false, 6_000)).toBe(true);
		expect(limit.see(false, 4_000 + LIMIT.clearAfterMs)).toBe(false);
	});

	it('says to shift easier, and at the ceiling on a cassette to move the chain', () => {
		expect(limitLine('grade-min', true)).toBe(
			'Your trainer is at its limit in this gear — shift easier.',
		);
		expect(limitLine('grade-max', false)).toBe(
			'Your trainer is at its limit in this gear — shift easier.',
		);
		expect(limitLine('grade-max', true)).toBe(
			'Your trainer is at its limit in this gear — shift easier, or move your chain to a smaller cog.',
		);
	});
});
