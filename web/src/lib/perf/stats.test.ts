import { describe, expect, it } from 'vitest';
import { createAggregator, quantile, videoDelta } from './stats';

describe('quantile', () => {
	it('takes the nearest rank, as the bench does', () => {
		const xs = [5, 1, 4, 2, 3];
		expect(quantile(xs, 0.5)).toBe(3);
		expect(quantile(xs, 0.95)).toBe(5);
		expect(quantile(xs, 0)).toBe(1);
		expect(quantile(xs, 1)).toBe(5);
	});

	it('leaves its input alone and says NaN for nothing', () => {
		const xs = [3, 1, 2];
		quantile(xs, 0.5);
		expect(xs).toEqual([3, 1, 2]);
		expect(quantile([], 0.5)).toBeNaN();
	});
});

describe('the overlay aggregator', () => {
	it('counts page frames a second and their intervals', () => {
		const agg = createAggregator(5000);
		// 60 Hz for a second, then one 100 ms stall.
		for (let i = 0; i <= 60; i++) agg.frame(1000 + (i * 1000) / 60);
		agg.frame(2100);
		const s = agg.summary(2100);
		expect(s.windowMs).toBeCloseTo(1100);
		expect(s.fps).toBeCloseTo(61 / 1.1);
		expect(s.frame.p50).toBeCloseTo(1000 / 60);
		expect(s.frame.max).toBeCloseTo(100);
	});

	it('sums each span into runs a second and ms a second, busiest first', () => {
		const agg = createAggregator(5000);
		agg.frame(0);
		for (let t = 1; t <= 30; t++) agg.span('world-frame', 4, t * (1000 / 30));
		for (let t = 1; t <= 15; t++) agg.span('lounge-frame', 1, t * (1000 / 15));
		agg.span('channel-message', 20, 1000);
		const s = agg.summary(1000);
		expect(s.spans.map((x) => x.name)).toEqual([
			'world-frame',
			'channel-message',
			'lounge-frame',
		]);
		const world = s.spans[0];
		expect(world.rate).toBeCloseTo(30);
		expect(world.p50).toBe(4);
		expect(world.perSecond).toBeCloseTo(120);
		expect(s.spans[1]).toMatchObject({ rate: 1, p95: 20, max: 20 });
	});

	it('forgets what is older than its window', () => {
		const agg = createAggregator(1000);
		agg.span('world-frame', 50, 100);
		agg.longTask(80, 100);
		agg.span('world-frame', 2, 1900);
		const s = agg.summary(2000);
		expect(s.spans[0].max).toBe(2);
		expect(s.longTasks).toEqual({ count: 0, ms: 0, max: 0 });
	});

	it('totals the long tasks in its window', () => {
		const agg = createAggregator(5000);
		agg.frame(0);
		agg.longTask(60, 500);
		agg.longTask(140, 900);
		expect(agg.summary(1000).longTasks).toEqual({
			count: 2,
			ms: 200,
			max: 140,
		});
	});

	it('says nothing a second before anything happened', () => {
		const s = createAggregator().summary(0);
		expect(s.fps).toBe(0);
		expect(s.spans).toEqual([]);
		expect(s.frame.p50).toBeNaN();
	});
});

describe('the videos between two readings', () => {
	it('counts decoded and dropped frames a second over the videos with a picture', () => {
		const a = {};
		const b = {};
		const c = {};
		const before = new Map([
			[a, { width: 640, height: 360, frames: 100, dropped: 1 }],
			[b, { width: 1920, height: 1080, frames: 10, dropped: 0 }],
		]);
		const after = new Map([
			[a, { width: 640, height: 360, frames: 130, dropped: 3 }],
			[b, { width: 1920, height: 1080, frames: 16, dropped: 0 }],
			// No picture yet: not playing.
			[c, { width: 0, height: 0, frames: 0, dropped: 0 }],
		]);
		expect(videoDelta(before, after, 2)).toEqual({
			playing: 2,
			fps: 18,
			dropped: 1,
			mp: (1920 * 1080) / 1e6,
		});
	});

	it('counts a video new since the last reading from its next one', () => {
		const v = {};
		const after = new Map([
			[v, { width: 320, height: 180, frames: 500, dropped: 9 }],
		]);
		expect(videoDelta(new Map(), after, 1)).toMatchObject({
			playing: 1,
			fps: 0,
			dropped: 0,
		});
	});
});
