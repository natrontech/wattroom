import { describe, expect, it } from 'vitest';
import {
	HEART_AXIS_BPM,
	heartAnchor,
	heartFraction,
	heartRuns,
	splitTrace,
	thinRun,
	tracePoint,
} from './trace';

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

	it('breaks where the clock moved backward', () => {
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

// The heart line (#4426): a second line over the blocks, on a scale of its
// own, drawn only where a strap reported.
describe('the heart line', () => {
	it('keeps a heart rate only while one reports', () => {
		expect(tracePoint(3, 210, 142.4)).toEqual({ t: 3, w: 210, h: 142 });
		expect(tracePoint(3, 210, 0)).toEqual({ t: 3, w: 210 });
		expect(tracePoint(3, 210)).toEqual({ t: 3, w: 210 });
	});

	it('breaks where the strap went quiet, never drawing down to zero', () => {
		const trace = [
			tracePoint(0, 200, 120),
			tracePoint(1, 200, 121),
			tracePoint(2, 200, 0),
			tracePoint(3, 200, 0),
			tracePoint(4, 200, 125),
			tracePoint(5, 200, 126),
		];
		expect(heartRuns(trace).map((run) => run.map((p) => p.h))).toEqual([
			[120, 121],
			[125, 126],
		]);
		// The power line is one run: the trainer never stopped.
		expect(splitTrace(trace)).toHaveLength(1);
	});

	it('breaks where the clock jumped, as the power line does', () => {
		const trace = [0, 1, 2, 600, 601].map((t) => tracePoint(t, 200, 130));
		expect(heartRuns(trace)).toHaveLength(2);
	});

	it('has no line with no heart rate', () => {
		const trace = [0, 1, 2].map((t) => tracePoint(t, 200));
		expect(heartRuns(trace)).toEqual([]);
	});

	it('puts LTHR on the FTP line and half of it on the floor', () => {
		expect(heartFraction(170, 170)).toBe(1);
		expect(heartFraction(85, 170)).toBe(0);
		expect(heartFraction(127.5, 170)).toBe(0.5);
		// Never under the floor: a resting heart stays on the baseline.
		expect(heartFraction(50, 170)).toBe(0);
		expect(heartFraction(120, 0)).toBe(0);
	});

	it('anchors on LTHR when set, else on a fixed axis that claims none', () => {
		expect(heartAnchor(172)).toBe(172);
		expect(heartAnchor(undefined)).toBe(HEART_AXIS_BPM);
		expect(heartAnchor(0)).toBe(HEART_AXIS_BPM);
		// A warm-up's heart sits low on it, not on the FTP line.
		expect(heartFraction(111, heartAnchor())).toBeLessThan(0.5);
	});

	it('thins by the heart rate, keeping its own peaks', () => {
		const run = Array.from({ length: 7200 }, (_, t) =>
			tracePoint(t, 200, 120 + (t % 11)),
		);
		const thinned = thinRun(run, 7.2, (p) => p.h ?? 0);
		expect(Math.min(...thinned.map((p) => p.h ?? 0))).toBe(120);
		expect(Math.max(...thinned.map((p) => p.h ?? 0))).toBe(130);
	});
});
