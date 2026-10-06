import { describe, expect, it } from 'vitest';
import { kmTicks, profileArea, walk } from './draw';

describe('one drawing of a road (#3679)', () => {
	it('ticks every 10 km, every 5 km under 20 km, and not at all under 5 km', () => {
		expect(kmTicks(4_000)).toEqual([]);
		expect(kmTicks(15_000)).toEqual([5, 10]);
		expect(kmTicks(52_000)).toEqual([10, 20, 30, 40, 50]);
	});

	it('fills the profile in the grade ramp, a step at 3 % and the last at 12 %', () => {
		// 1 km a sample: 2.9 %, 3.0 %, then 12.0 %.
		const runs = profileArea([0, 29, 59, 179], 3_000, 300, 100);
		expect(runs.map((r) => r.step)).toEqual([0, 1, 4]);
	});

	it('runs the samples of one step together as one area', () => {
		const runs = profileArea([0, 50, 100, 100, 100], 4_000, 400, 100);
		expect(runs.map((r) => r.step)).toEqual([1, 0]);
	});

	it('walks a line by its length, so metres land on any sampling', () => {
		const line = walk([
			[0, 0],
			[10, 0],
			[10, 30],
		]);
		expect(line.point(0)).toEqual([0, 0]);
		expect(line.point(0.25)).toEqual([10, 0]);
		expect(line.point(1)).toEqual([10, 30]);
		expect(line.between(0, 0.5)).toBe('M0.0 0.0 L10.0 0.0 L10.0 10.0');
	});
});
