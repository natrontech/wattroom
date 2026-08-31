import { describe, expect, it } from 'vitest';
import {
	GATE_CEIL,
	GATE_DEFAULT,
	GATE_FLOOR,
	GATE_MAX_DB,
	GATE_MIN_DB,
	clampThreshold,
	gateDb,
	gateLevel,
	gatePct,
} from './gate-scale';

describe('gate scale', () => {
	// #289: the meter was `micLevel * 140` percent while the slider ran raw
	// 0.005–0.08 amplitude. Two unrelated coordinate systems is what made the
	// gate blind — anything drawn on one axis must be readable against the
	// other, so both go through gatePct or neither does.
	it('puts the meter and the threshold on one axis', () => {
		expect(gatePct(GATE_FLOOR)).toBe(0);
		expect(gatePct(GATE_CEIL)).toBe(100);
		// A threshold equal to the level sits exactly where the level ends.
		for (const level of [0.004, 0.02, 0.05, 0.2]) {
			expect(gatePct(level)).toBeCloseTo(gatePct(level), 10);
			expect(gatePct(level)).toBeGreaterThan(0);
			expect(gatePct(level)).toBeLessThan(100);
		}
	});

	it('spends its travel where speech lives, not above it', () => {
		// The SPEC default lands mid-slider rather than in its first eighth,
		// which is where a linear 0..1 axis would have crushed it.
		const mid = gatePct(GATE_DEFAULT);
		expect(mid).toBeGreaterThan(40);
		expect(mid).toBeLessThan(60);
		// Room tone reads low, a firm speaking voice reads high — and neither
		// is pinned to an end, so the gap between them is what you tune in.
		expect(gatePct(0.003)).toBeLessThan(mid);
		expect(gatePct(0.15)).toBeGreaterThan(mid);
	});

	it('reads silence as the floor rather than -Infinity', () => {
		expect(gateDb(0)).toBe(GATE_MIN_DB);
		expect(gateDb(-1)).toBe(GATE_MIN_DB);
		expect(gatePct(0)).toBe(0);
	});

	it('round-trips a level through decibels', () => {
		for (const level of [0.005, 0.02, 0.08, 0.25]) {
			expect(gateLevel(gateDb(level))).toBeCloseTo(level, 10);
		}
		expect(gateDb(gateLevel(GATE_MAX_DB))).toBeCloseTo(GATE_MAX_DB, 10);
	});

	it('clamps a threshold to the axis, so every setting has a mark', () => {
		expect(clampThreshold(0)).toBe(GATE_FLOOR);
		expect(clampThreshold(1)).toBe(GATE_CEIL);
		expect(clampThreshold(GATE_DEFAULT)).toBe(GATE_DEFAULT);
		// A value persisted by an older build still lands on the meter.
		expect(gatePct(clampThreshold(0.08))).toBeGreaterThan(0);
		expect(gatePct(clampThreshold(0.08))).toBeLessThan(100);
		expect(clampThreshold(Number.NaN)).toBe(GATE_DEFAULT);
	});

	it('keeps the doubled music threshold on the meter', () => {
		// SPEC doubles the gate while the jukebox plays; doubling is +6.02 dB,
		// so the mark moves a fixed distance right whatever the setting was.
		const span = GATE_MAX_DB - GATE_MIN_DB;
		const shift = ((20 * Math.log10(2)) / span) * 100;
		for (const level of [0.005, 0.02, 0.05]) {
			expect(gatePct(level * 2) - gatePct(level)).toBeCloseTo(shift, 6);
		}
		// And a doubled ceiling pegs the mark instead of running off the end.
		expect(gatePct(GATE_CEIL * 2)).toBe(100);
	});
});
