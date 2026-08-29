import { describe, expect, it } from 'vitest';
import { splitTrace } from './trace';

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
