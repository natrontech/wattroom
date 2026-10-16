import { describe, expect, it } from 'vitest';
import { judge, report, windowFor, type Sample } from './gate';

/** A flat soak's minute, with `over` laid on top. */
const sample = (minute: number, over: Partial<Sample> = {}): Sample => ({
	minute,
	wallS: minute * 4,
	km: minute * 0.5,
	heapMB: 80,
	geometries: 200,
	textures: 12,
	programs: 9,
	draws: 40,
	triangles: 300_000,
	groundHeld: 300,
	groundWindow: 320,
	listeners: 150,
	intervals: 3,
	timeouts: 2,
	frames: 1,
	rendered: 400,
	frameP50: 33,
	frameP95: 40,
	costP50: 8,
	costP95: 12,
	hitches: 0,
	...over,
});

const ride = (
	minutes: number,
	at: (m: number) => Partial<Sample> = () => ({}),
) => Array.from({ length: minutes + 1 }, (_, m) => sample(m, at(m)));

describe('the soak gate', () => {
	it('passes a flat ride, minute 0 warming up however it likes', () => {
		const v = judge(
			ride(120, (m) => (m === 0 ? { heapMB: 400, textures: 90 } : {})),
			120,
		);
		expect(v.failures).toEqual([]);
		expect(v.ok).toBe(true);
	});

	it('fails a heap that climbs past 10 %', () => {
		const v = judge(
			ride(120, (m) => ({ heapMB: 80 + m * 0.2 })),
			120,
		);
		expect(v.ok).toBe(false);
		expect(v.failures.join()).toMatch(/heapMB/);
	});

	it('fails a texture leaked per tile, by the mean and by the ceiling', () => {
		const v = judge(
			ride(120, (m) => ({ textures: 12 + Math.floor(m / 4) })),
			120,
		);
		expect(v.failures.filter((f) => f.startsWith('textures'))).toHaveLength(2);
	});

	it('fails one listener left behind each minute, and not one listener once', () => {
		expect(
			judge(
				ride(120, (m) => ({ listeners: 150 + m })),
				120,
			).ok,
		).toBe(false);
		expect(
			judge(
				ride(120, (m) => ({ listeners: m > 60 ? 151 : 150 })),
				120,
			).ok,
		).toBe(true);
	});

	it('judges frame times on a GPU only', () => {
		const slower = ride(120, (m) => ({ frameP95: 40 + m }));
		expect(judge(slower, 120).failures.join()).toMatch(/frameP95/);
		const soft = judge(slower, 120, { software: true });
		expect(soft.ok).toBe(true);
		expect(soft.framesJudged).toBe(false);
	});

	it('fails an interval where none was', () => {
		const v = judge(
			ride(30, (m) => ({ intervals: m > 20 ? 3 : 0 })),
			30,
		);
		expect(v.failures.join()).toMatch(/intervals/);
	});

	it('fails ground held past the window the streamer means', () => {
		const v = judge(
			ride(30, (m) => (m === 17 ? { groundHeld: 321 } : {})),
			30,
		);
		expect(v.failures).toEqual([
			'ground: 321 chunks held at minute 17, where the streamer means at most 320',
		]);
	});

	it('compares thirds of a short soak, and refuses one with no samples', () => {
		expect(windowFor(120)).toBe(30);
		expect(windowFor(240)).toBe(30);
		expect(windowFor(15)).toBe(5);
		expect(judge([sample(0)], 15).ok).toBe(false);
	});

	it('reports in numbers', () => {
		const samples = ride(10);
		const text = report(samples, 10, 16, judge(samples, 10));
		expect(text).toContain('**Flat.**');
		expect(text).toContain('| heapMB | 80 | 80 | 0 % | ok |');
	});
});
