import { describe, expect, it } from 'vitest';
import { splitTrace, thinRun } from './trace';

const at = (...ts: number[]) => ts.map((t) => ({ t, w: 200 }));

describe('splitTrace', () => {
	it('keeps a continuous ride as one run', () => {
		expect(splitTrace(at(0, 1, 2, 3))).toHaveLength(1);
	});

	it('breaks where skip jumped the clock forward', () => {
		// Rode 0–2 s, skipped to the 600 s block: the gap was never ridden.
		const runs = splitTrace(at(0, 1, 2, 600, 601, 602));
		expect(runs).toHaveLength(2);
		expect(runs[0].map((p) => p.t)).toEqual([0, 1, 2]);
		expect(runs[1].map((p) => p.t)).toEqual([600, 601, 602]);
	});

	it('breaks where extend moved the clock backward', () => {
		// This is the one that drew the line in reverse.
		const runs = splitTrace(at(100, 101, 102, 42, 43, 44));
		expect(runs).toHaveLength(2);
		expect(runs[1].map((p) => p.t)).toEqual([42, 43, 44]);
	});

	it('drops orphan points rather than drawing a one-point line', () => {
		expect(splitTrace(at(0, 1, 2, 600))).toHaveLength(1);
	});

	it('tolerates a dropped sample without breaking the line', () => {
		// A single missed notification is a gap of 2 s, not a discontinuity.
		expect(splitTrace(at(0, 1, 3, 4))).toHaveLength(1);
	});

	it('handles an empty trace', () => {
		expect(splitTrace([])).toEqual([]);
	});
});

// A long ride's line is built from at most two points per viewBox unit
// (#2878): a 2 h ride used to put 7 200 points in one polyline, rebuilt
// every second, where the graph can draw about 2 000.
describe('thinRun', () => {
	const ride = (seconds: number) =>
		Array.from({ length: seconds }, (_, t) => ({ t, w: 200 + (t % 7) * 10 }));

	it('keeps a run that already fits', () => {
		const run = ride(300);
		expect(thinRun(run, 1)).toBe(run);
	});

	it('keeps each bucket’s low and high, in time order', () => {
		const thinned = thinRun(ride(7200), 7200 / 1000);
		expect(thinned.length).toBeLessThanOrEqual(2 * 1000 + 2);
		expect(thinned.length).toBeGreaterThan(1000);
		expect(Math.min(...thinned.map((p) => p.w))).toBe(200);
		expect(Math.max(...thinned.map((p) => p.w))).toBe(260);
		for (let i = 1; i < thinned.length; i++)
			expect(thinned[i].t).toBeGreaterThan(thinned[i - 1].t);
	});
});
