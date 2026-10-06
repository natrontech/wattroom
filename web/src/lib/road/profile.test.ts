import { describe, expect, it } from 'vitest';
import { movingAverage, rollingMedian } from './profile';

const ramp = (n: number, perStep: number, from = 400) =>
	Float64Array.from({ length: n }, (_, i) => from + i * perStep);

const steps = (a: Float64Array) =>
	Array.from(a.subarray(1), (v, i) => v - a[i]);

// The 200 m median and 120 m average on 10 m samples, as route.ts takes them.
const MEDIAN_HALF = 10;
const AVERAGE_HALF = 6;
const smooth = (a: Float64Array) =>
	movingAverage(rollingMedian(a, MEDIAN_HALF), AVERAGE_HALF);

describe('road profile smoothing keeps a constant grade to both ends (#3832)', () => {
	const cases = [
		{ name: '3 % climb', perStep: 0.3 },
		{ name: '−6 % descent', perStep: -0.6 },
		{ name: 'flat road', perStep: 0 },
	];
	for (const { name, perStep } of cases) {
		it(`${name}: every step survives the median then the average`, () => {
			const out = smooth(ramp(200, perStep));
			for (const s of steps(out)) expect(s).toBeCloseTo(perStep, 9);
		});
		it(`${name}: each stage alone keeps its steps`, () => {
			const a = ramp(60, perStep);
			for (const out of [
				rollingMedian(a, MEDIAN_HALF),
				movingAverage(a, AVERAGE_HALF),
			])
				for (const s of steps(out)) expect(s).toBeCloseTo(perStep, 9);
		});
	}

	it('a road shorter than one window keeps its grade too', () => {
		for (const n of [1, 2, 3, 8, 15]) {
			const out = smooth(ramp(n, 0.3));
			expect(out.length).toBe(n);
			for (const s of steps(out)) expect(s).toBeCloseTo(0.3, 9);
		}
		expect(smooth(new Float64Array(0)).length).toBe(0);
	});

	it('samples with a whole window of road around them are unchanged by the ends', () => {
		const a = Float64Array.from(
			{ length: 120 },
			(_, i) => 400 + 12 * Math.sin(i / 7) + (i % 5) * 0.37 + i * 0.1,
		);
		const direct = (i: number, half: number) => {
			let s = 0;
			for (let k = i - half; k <= i + half; k++) s += a[k];
			return s / (2 * half + 1);
		};
		const avg = movingAverage(a, AVERAGE_HALF);
		for (let i = AVERAGE_HALF; i < a.length - AVERAGE_HALF; i++)
			expect(avg[i]).toBe(direct(i, AVERAGE_HALF));
		const med = rollingMedian(a, MEDIAN_HALF);
		for (let i = MEDIAN_HALF; i < a.length - MEDIAN_HALF; i++) {
			const w = Array.from(a.subarray(i - MEDIAN_HALF, i + MEDIAN_HALF + 1));
			w.sort((p, q) => p - q);
			expect(med[i]).toBe(w[MEDIAN_HALF]);
		}
	});

	it('a bad first or last fix does not bend the approach', () => {
		for (const bad of [0, 199]) {
			const a = ramp(200, 0.3);
			a[bad] += 40;
			const out = smooth(a);
			const clean = smooth(ramp(200, 0.3));
			for (let i = 0; i < a.length; i++)
				expect(Math.abs(out[i] - clean[i])).toBeLessThan(40 / 13 + 1e-9);
			// One rank of the window, not the fix's 40 m.
			expect(
				Math.abs(rollingMedian(a, MEDIAN_HALF)[bad] - (a[bad] - 40)),
			).toBeLessThan(0.31);
		}
	});
});
