// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createPacer } from './loop';
import {
	deviceKey,
	LADDER,
	type Ladder,
	type Measured,
	p90,
	rememberedRung,
	rememberRung,
	type Rung,
	startRung,
	stepped,
	windows,
} from './quality';

/** `n` frames of GPU time `ms`, none missed. */
const gpu = (ms: number, n = 90): Measured => ({
	rendered: n,
	missed: 0,
	gpuMs: Array(n).fill(ms),
});
/** `n` intervals, `share` of them missed, no GPU times. */
const missing = (share: number, n = 100): Measured => ({
	rendered: Math.round(n * (1 - share)),
	missed: Math.round(n * share),
	gpuMs: [],
});

describe('the count-in probe picks the start rung (#3295)', () => {
	it.each<[string, Measured, Rung | null, Rung]>([
		// GPU time, first ride (drawn at L3): the highest rung predicted under 10 ms.
		['a fast GPU keeps L3', gpu(4), null, 3],
		['L3 just in budget', gpu(10), null, 3],
		['L3 over, L2 under: 12 × 2.5 / 4.15 ≈ 7.2 ms', gpu(12), null, 2],
		['L2 over, L1 under: 20 × 1.95 / 4.15 ≈ 9.4 ms', gpu(20), null, 1],
		['nothing under: L1, the floor', gpu(40), null, 1],
		// GPU time, remembered: never above it but for one rung, with 40 % headroom.
		['L2 remembered, L3 predicted 6.6 ms: no headroom', gpu(4), 2, 2],
		['L2 remembered, L3 predicted 5.8 ms: one rung up', gpu(3.5), 2, 3],
		['L1 remembered, a fast GPU: one rung only', gpu(1), 1, 2],
		[
			'L2 remembered, slower now: 12 × 1.95 / 2.5 ≈ 9.4 ms on L1',
			gpu(12),
			2,
			1,
		],
		// No GPU timer: the missed share at the rung drawn.
		['none missed keeps the top', missing(0), null, 3],
		['5 % missed is not slow', missing(0.05), null, 3],
		['6 % missed starts a rung down', missing(0.06), null, 2],
		['missing at L1 stays at the floor', missing(0.5), 1, 1],
		['no timer never climbs', missing(0), 2, 2],
	])('%s', (_, probe, was, rung) => {
		expect(startRung(probe, was)).toBe(rung);
	});
});

describe('the ride steps down, never up', () => {
	const run = (from: Ladder, ws: Measured[]) =>
		ws.reduce((l, w) => stepped(l, w), from);
	const at3: Ladder = { rung: 3, strikes: 0 };

	it.each<[string, Measured[], Rung]>([
		['good windows keep the rung', [gpu(8), missing(0.02)], 3],
		['one slow window is not enough', [missing(0.1)], 3],
		['two slow in a row step down once', [missing(0.1), gpu(17)], 2],
		['a good one between resets the count', [missing(0.1), gpu(5), gpu(17)], 3],
		['four slow step down twice', Array(4).fill(missing(0.3)), 1],
		['never under L1', Array(10).fill(missing(0.9)), 1],
		['p90, not the mean: a tenth over 16 ms is fine', [mixed(), mixed()], 3],
	])('%s', (_, ws, rung) => {
		expect(run(at3, ws).rung).toBe(rung);
	});

	it('never steps up mid-ride', () => {
		const down = run(at3, [missing(0.1), missing(0.1)]);
		expect(run(down, Array(20).fill(gpu(1))).rung).toBe(2);
	});

	/** 90 frames at 5 ms and 10 at 40 ms: p90 is 5. */
	function mixed(): Measured {
		return {
			rendered: 100,
			missed: 0,
			gpuMs: [...Array(90).fill(5), ...Array(10).fill(40)],
		};
	}
});

describe('a forced slow window (acceptance)', () => {
	it('steps down once over two slow windows from a pacer at 20 fps', () => {
		// 60 Hz, every render costing three vsyncs: a third of the intervals missed.
		const pacer = createPacer();
		const cut = windows();
		let ladder: Ladder = { rung: 3, strikes: 0 };
		const rungs: Rung[] = [];
		let now = 0;
		for (let second = 0; second <= 2 * LADDER.windowS; second++) {
			while (now < second * 1000)
				now += (pacer.tick(now) ? 3 : 1) * (1000 / 60);
			const w = cut(pacer.stats(), []);
			if (w) {
				ladder = stepped(ladder, w);
				rungs.push(ladder.rung);
			}
		}
		expect(rungs).toEqual([3, 2]);
	});
});

describe('windows', () => {
	it('counts only seconds that drew', () => {
		const cut = windows();
		let s = { rendered: 0, missed: 0, hz: 60 };
		expect(cut(s, [])).toBeNull();
		const out: (Measured | null)[] = [];
		for (let i = 0; i < 25; i++) {
			// Every other second the gate is shut: nothing drawn.
			if (i % 2 === 0) s = { ...s, rendered: s.rendered + 30 };
			out.push(cut(s, i % 2 === 0 ? [3] : []));
		}
		const done = out.filter((w) => w !== null);
		expect(done).toHaveLength(1);
		expect(done[0]).toEqual({
			rendered: 300,
			missed: 0,
			gpuMs: Array(10).fill(3),
		});
	});

	it('p90 is the nearest rank', () => {
		expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
		expect(p90([7])).toBe(7);
	});
});

describe('the remembered rung', () => {
	afterEach(() => localStorage.clear());

	it('is kept per renderer and canvas size', () => {
		const a = deviceKey('Apple M2', 1280, 900);
		const b = deviceKey('Apple M2', 1920, 1080);
		rememberRung(a, 2);
		expect(rememberedRung(a)).toBe(2);
		expect(rememberedRung(b)).toBeNull();
		rememberRung(b, 1);
		expect(rememberedRung(a)).toBe(2);
		expect(JSON.parse(localStorage.getItem('wattroom.world.tier.v1')!)).toEqual(
			{ [a]: 2, [b]: 1 },
		);
	});

	it('reads nothing from a broken entry', () => {
		localStorage.setItem('wattroom.world.tier.v1', '{not json');
		expect(rememberedRung('x')).toBeNull();
		localStorage.setItem('wattroom.world.tier.v1', '{"x":7}');
		expect(rememberedRung('x')).toBeNull();
	});
});
