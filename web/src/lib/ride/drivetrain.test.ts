import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeSimulation } from '$lib/ble/ftms';
import { BikeKg, PaceGravity, ReferenceRiderKg } from '$lib/protocol';
import {
	GEAR_RATIOS,
	GEARS,
	gearSpace,
	ratioState,
	simTransform,
	trackRatio,
} from './drivetrain';
import { KICKR_CORE_10 } from './kickr-core-10.test-helper';

/** A seeded uniform [0, 1): the same cases on every run. */
function seeded(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const between = (rand: () => number, lo: number, hi: number) =>
	lo + (hi - lo) * rand();

const M = ReferenceRiderKg + BikeKg;
const WHEEL = 2.096;
const flywheel = (rpm: number, ratio: number) => (rpm / 60) * ratio * WHEEL;

/** A trainer's force at flywheel speed v from the road it was sent. */
function force(
	road: { gradePct: number; crr: number; cw: number; windMps: number },
	v: number,
) {
	const theta = Math.atan(road.gradePct / 100);
	const air = v + road.windMps;
	return (
		M * PaceGravity * (Math.sin(theta) + road.crr * Math.cos(theta)) +
		road.cw * air * Math.abs(air)
	);
}

/** The road as the trainer reads it back off the wire, at FTMS resolution. */
function decoded(road: Parameters<typeof encodeSimulation>[0]) {
	const view = new DataView(encodeSimulation(road));
	return {
		windMps: view.getInt16(1, true) / 1000,
		gradePct: view.getInt16(3, true) / 100,
		crr: view.getUint8(5) / 10000,
		cw: view.getUint8(6) / 100,
	};
}

describe('the transform (ADR-0084)', () => {
	// Riding speeds: 60–110 rpm on real ratios up to 4.0 keep the flywheel
	// under 15.4 m/s, where the Cw field's 0.01 kg/m is worth ±1.19 N. No
	// wind: a WattRoom road carries none yet.
	it('makes the trainer resist with k·F(k·v) within 1.3 N over 5,000 cases', () => {
		const rand = seeded(3325);
		let checked = 0;
		for (let i = 0; i < 5000; i++) {
			const real = between(rand, 1.2, 4);
			const gear = 1 + Math.floor(rand() * GEAR_RATIOS.length);
			const k = GEAR_RATIOS[gear - 1] / real;
			const v = flywheel(between(rand, 60, 110), real);
			const felt = { gradePct: between(rand, -5, 15), windMps: 0 };
			const shelter = between(rand, 0, 0.5);
			const { road, clamp } = simTransform(felt, shelter, k, v);
			if (clamp || road.crr > 0.0255) continue;
			checked++;
			const want =
				k * force({ ...felt, crr: 0.004, cw: 0.51 * (1 - shelter) }, k * v);
			expect(Math.abs(force(decoded(road), v) - want)).toBeLessThanOrEqual(1.3);
		}
		// Clamps are the ride's to report, not this property's to hide behind.
		expect(checked).toBeGreaterThan(4000);
	});

	it('keeps every field of the write in range across the encoding sweep', () => {
		const reals = [34 / 14, 42 / 14, 53 / 11, 34 / 28];
		for (const real of reals)
			for (const ratio of GEAR_RATIOS)
				for (let felt = -5; felt <= 15; felt += 0.5)
					for (const rpm of [60, 90, 120])
						for (const shelter of [0, 0.35, 0.5]) {
							const { road } = simTransform(
								{ gradePct: felt },
								shelter,
								ratio / real,
								flywheel(rpm, real),
							);
							expect(road.gradePct).toBeGreaterThanOrEqual(-10);
							expect(road.gradePct).toBeLessThanOrEqual(15);
							expect(road.crr).toBeGreaterThanOrEqual(0);
							expect(road.crr).toBeLessThanOrEqual(0.0255);
							expect(road.cw).toBeGreaterThanOrEqual(0);
							expect(road.cw).toBeLessThanOrEqual(2.55);
							expect(Math.abs(road.windMps)).toBeLessThanOrEqual(32.767);
						}
	});
});

describe('the gear space', () => {
	it('moves the first shift half a step to a step and a half, and the label with it, over 20,000 real ratios', () => {
		const rand = seeded(20000);
		const step = GEAR_RATIOS[1] / GEAR_RATIOS[0];
		for (let i = 0; i < 20000; i++) {
			const real = between(rand, GEAR_RATIOS[1], GEAR_RATIOS.at(-2)!);
			const space = gearSpace(real, 1);
			for (const dir of [1, -1] as const) {
				const k = space.step(dir);
				const move = Math.abs(Math.log(k));
				expect(move).toBeGreaterThanOrEqual(Math.log(step) / 2 - 1e-9);
				expect(move).toBeLessThanOrEqual((Math.log(step) * 3) / 2 + 1e-9);
				expect(gearSpace(real, k).label).not.toBe(space.label);
			}
		}
	});

	it('starts a Cog rider at gear 15 with k = 1, and a 42×14 rider at 17', () => {
		expect(gearSpace(34 / 14, 1).gear).toBe(15);
		const road = gearSpace(42 / 14, 1);
		expect(road.gear).toBe(17);
		expect(gearSpace(42 / 14, road.step(-1)).gear).toBe(16);
		expect(gearSpace(42 / 14, road.step(1)).gear).toBe(18);
	});

	it('ends at gear 1 and gear 24', () => {
		const top = gearSpace(1, GEAR_RATIOS.at(-1)!);
		expect(top.atEnd(1)).toBe(true);
		expect(top.step(1)).toBe(GEAR_RATIOS.at(-1));
		expect(gearSpace(1, GEAR_RATIOS[0]).atEnd(-1)).toBe(true);
	});

	it('counts steps from the real gear when no ratio is known', () => {
		let k = 1;
		for (let i = 0; i < 3; i++) k = gearSpace(null, k).step(1);
		expect(gearSpace(null, k).label).toBe('+3');
		expect(gearSpace(null, 1 / 1.0907 ** 2).label).toBe('−2');
		expect(gearSpace(null, 2.1).atEnd(1)).toBe(true);
		expect(gearSpace(null, 0.31).atEnd(-1)).toBe(true);
	});
});

describe('real-ratio detection', () => {
	/** A sample at this true ratio, cadence and per-sample noise. */
	const sample = (ratio: number, rpm: number, noise = 0) => ({
		watts: 200,
		cadence: rpm,
		speedMps: flywheel(rpm, ratio) * (1 + noise),
		at: 0,
	});
	/** A seeded normal draw, Box–Muller. */
	const normal = (rand: () => number) =>
		Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

	it('re-labels nothing in 10 h of 2 % per-sample noise', () => {
		const rand = seeded(10);
		const state = ratioState();
		let relabels = 0;
		for (let s = 0; s < 10 * 3600; s++)
			if (trackRatio(state, sample(3, 90, 0.02 * normal(rand)))) relabels++;
		expect(relabels).toBe(0);
		expect(state.ratio).toBeCloseTo(3, 1);
	});

	it('re-labels a 42×14 → 42×17 move within 5 s of its first sample', () => {
		const state = ratioState();
		for (let s = 0; s < 30; s++) trackRatio(state, sample(42 / 14, 90));
		let at = -1;
		for (let s = 0; s < 10 && at < 0; s++)
			if (trackRatio(state, sample(42 / 17, 90))) at = s;
		expect(at).toBeGreaterThanOrEqual(0);
		expect(at).toBeLessThanOrEqual(5);
		expect(state.ratio).toBeCloseTo(42 / 17, 6);
	});

	it("reads 2.87–2.95 off the Kickr Core's own #10 samples", () => {
		const state = ratioState();
		for (const [rpm, kph] of KICKR_CORE_10)
			trackRatio(state, { watts: 0, cadence: rpm, speedMps: kph / 3.6, at: 0 });
		expect(state.ratio).toBeGreaterThanOrEqual(2.87);
		expect(state.ratio).toBeLessThanOrEqual(2.95);
	});

	it('ignores samples outside 60–110 rpm, and everything when switched off', () => {
		const state = ratioState();
		for (let s = 0; s < 20; s++) trackRatio(state, sample(3, 50));
		expect(state.ratio).toBeNull();
		const off = ratioState(false);
		for (let s = 0; s < 20; s++) trackRatio(off, sample(3, 90));
		expect(off.ratio).toBeNull();
	});

	// #3515: a flywheel reporting 0 m/s at 90 rpm read as a ratio of 0, and
	// the next Harder divided a table gear by it — k = Infinity.
	it('takes no ratio from a stopped flywheel, and a shift from none stays in range', () => {
		const state = ratioState();
		for (let s = 0; s < 20; s++) trackRatio(state, sample(0, 90));
		expect(state.ratio).toBeNull();
		for (const ratio of [null, 0, -1, NaN]) {
			const k = gearSpace(ratio, 1).step(1);
			expect(k, `k after a shift from ratio ${ratio}`).toBeLessThanOrEqual(
				GEARS.blindMax,
			);
		}
	});
});

describe("the trainer's speed (ADR-0084)", () => {
	it('is read by the drivetrain alone', () => {
		const src = new URL('../../', import.meta.url).pathname;
		const readers: string[] = [];
		const walk = (dir: string) => {
			for (const name of readdirSync(dir)) {
				const path = join(dir, name);
				if (statSync(path).isDirectory()) walk(path);
				else if (
					/\.(ts|svelte)$/.test(name) &&
					!/\.test(-helper)?\.ts$/.test(name) &&
					name !== 'drivetrain.ts' &&
					/\.speedMps\b/.test(readFileSync(path, 'utf8'))
				)
					readers.push(path.slice(src.length));
			}
		};
		walk(src);
		expect(readers).toEqual([]);
	});
});
