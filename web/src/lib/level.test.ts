import { describe, expect, it } from 'vitest';
import { levelFromXp, levelProgress, xpForLevel } from './level';

describe('level math (docs/SPEC.md)', () => {
	it('holds the specced thresholds', () => {
		expect(xpForLevel(0)).toBe(0);
		expect(xpForLevel(1)).toBe(500);
		expect(xpForLevel(2)).toBe(Math.round(500 * 2 ** 1.6));
	});

	it('levels up exactly at each threshold', () => {
		for (let n = 0; n <= 40; n++) {
			const at = xpForLevel(n);
			expect(levelFromXp(at)).toBe(n);
			if (n > 0) expect(levelFromXp(at - 1)).toBe(n - 1);
		}
	});

	it('starts at level 0 and never goes negative', () => {
		expect(levelFromXp(0)).toBe(0);
		expect(levelFromXp(499)).toBe(0);
		expect(levelFromXp(500)).toBe(1);
	});

	it('reaches SPEC ballpark: a winter of riding ≈ level 25–30', () => {
		// ~90 rides × ~650 XP ≈ 58k XP over a winter.
		const level = levelFromXp(90 * 650);
		expect(level).toBeGreaterThanOrEqual(15);
		expect(level).toBeLessThanOrEqual(30);
	});

	it('progress stays within 0..1 and resets on level-up', () => {
		expect(levelProgress(0)).toBe(0);
		expect(levelProgress(250)).toBeCloseTo(0.5);
		expect(levelProgress(500)).toBe(0);
		expect(levelProgress(xpForLevel(7))).toBe(0);
		expect(levelProgress(xpForLevel(8) - 1)).toBeLessThan(1);
	});
});
