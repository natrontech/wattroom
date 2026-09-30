// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createLoop, createPacer, type Gate, watchPage } from './loop';

/** Which of `n` animation frames at `hz` render, as a 1/0 string; `jitter` ms either way. */
function pattern(hz: number, n: number, jitter = 0): string {
	const pacer = createPacer();
	let seed = 7;
	const wobble = () =>
		((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * jitter;
	let out = '';
	for (let i = 0; i < n; i++)
		out += pacer.tick((i * 1000) / hz + (i ? wobble() : 0)) ? '1' : '0';
	return out;
}

/**
 * A display at `hz` whose renders take `cost` vsyncs: the frame after a
 * render comes that many vsyncs later, the frame after one that drew nothing
 * comes on the next. Returns the pacer after `ms` of it.
 */
function ride(hz: number, cost: number, ms: number) {
	const pacer = createPacer();
	for (let now = 0; now < ms;)
		now += (pacer.tick(now) ? cost : 1) * (1000 / hz);
	return pacer;
}

const every = (k: number, n: number) =>
	Array.from({ length: n }, (_, i) => (i % k === 0 ? '1' : '0')).join('');

describe('the pacer', () => {
	it.each([
		[60, 2],
		[120, 4],
		[144, 5],
		[165, 6],
		[30, 1],
	])('renders every frame on its divisor at %i Hz: every %i', (hz, k) => {
		expect(pattern(hz, 120)).toBe(every(k, 120));
	});

	it('stays even through vsync jitter', () => {
		expect(pattern(60, 60, 1.5)).toBe(every(2, 60));
	});

	it('misses nothing while the display keeps up', () => {
		const pacer = createPacer();
		for (let i = 0; i < 600; i++) pacer.tick((i * 1000) / 144);
		expect(pacer.stats().missed).toBe(0);
		expect(pacer.stats().hz).toBeCloseTo(144, 0);
	});

	it('counts a stall as the divisor intervals it swallowed', () => {
		const pacer = createPacer();
		let now = 0;
		for (let i = 0; i < 30; i++) pacer.tick((now = (i * 1000) / 60));
		// Five 60 Hz divisor intervals pass as one frame: four were missed.
		expect(pacer.tick(now + 10 * (1000 / 60))).toBe(true);
		expect(pacer.stats().missed).toBe(4);
	});

	it('counts a steady 20 fps as a third of its intervals missed', () => {
		// 60 Hz, and every render overruns into a third vsync: 20 fps, not 30.
		const { missed, rendered } = ride(60, 3, 3000).stats();
		expect(rendered).toBeCloseTo(60, -1);
		expect(missed / (missed + rendered)).toBeCloseTo(1 / 3, 1);
	});

	it('counts a render that overruns one vsync as no miss: 30 fps is still made', () => {
		const pacer = ride(60, 2, 3000);
		expect(pacer.stats().missed).toBe(0);
		expect(pacer.stats().hz).toBeCloseTo(60, 0);
	});

	it('renders once a second while idle, and counts no misses for it', () => {
		const pacer = createPacer();
		let drawn = 0;
		for (let i = 0; i < 300; i++)
			if (pacer.tick((i * 1000) / 60, i > 0)) drawn++;
		expect(drawn).toBe(1 + 4); // the first frame, then one a second
		expect(pacer.stats().missed).toBe(0);
	});

	it('renders at once when something moves again, and the idle stretch is no miss', () => {
		const pacer = createPacer();
		for (let i = 0; i < 20; i++) pacer.tick((i * 1000) / 60, true);
		expect(pacer.tick((20 * 1000) / 60, false)).toBe(true);
		for (let i = 21; i < 60; i++) pacer.tick((i * 1000) / 60, false);
		expect(pacer.stats().missed).toBe(0);
	});

	it('does not count a hold as missed frames', () => {
		const pacer = createPacer();
		for (let i = 0; i < 10; i++) pacer.tick((i * 1000) / 60);
		pacer.resume();
		expect(pacer.tick(60_000)).toBe(true);
		expect(pacer.stats().missed).toBe(0);
	});
});

/** Animation frames on demand: `pump` fires what is pending, at 60 Hz. */
function fakeFrames() {
	let pending: ((now: number) => void) | null = null;
	let now = 0;
	return {
		frames: {
			request(cb: (now: number) => void) {
				pending = cb;
				return 1;
			},
			cancel() {
				pending = null;
			},
		},
		pump(n: number) {
			for (let i = 0; i < n; i++) {
				now += 1000 / 60;
				const cb = pending;
				pending = null;
				cb?.(now);
			}
		},
	};
}

describe('the loop', () => {
	const GATES: Gate[] = ['hidden', 'offscreen', 'displaced', 'shell'];

	it.each(GATES)('draws nothing while %s', (gate) => {
		const f = fakeFrames();
		let drawn = 0;
		const loop = createLoop(
			() => drawn++,
			() => false,
			f.frames,
		);
		loop.start();
		f.pump(10);
		expect(drawn).toBe(5);
		loop.gate(gate, true);
		expect(loop.running).toBe(false);
		f.pump(60);
		expect(drawn).toBe(5);
		loop.gate(gate, false);
		f.pump(10);
		expect(drawn).toBe(10);
	});

	it('stays shut until every gate is open', () => {
		const f = fakeFrames();
		let drawn = 0;
		const loop = createLoop(
			() => drawn++,
			() => false,
			f.frames,
		);
		loop.start();
		loop.gate('hidden', true);
		loop.gate('shell', true);
		loop.gate('hidden', false);
		f.pump(20);
		expect(drawn).toBe(0);
		loop.gate('shell', false);
		f.pump(2);
		expect(drawn).toBe(1);
	});

	it('hands draw the real time since its last frame, and none after a hold', () => {
		const f = fakeFrames();
		const seconds: number[] = [];
		const loop = createLoop(
			(s) => seconds.push(s),
			() => false,
			f.frames,
		);
		loop.start();
		f.pump(4);
		loop.gate('hidden', true);
		loop.gate('hidden', false);
		f.pump(1);
		expect(seconds.map((s) => Math.round(s * 1000))).toEqual([0, 33, 0]);
	});

	it('counts no misses for the time a gate held it', () => {
		const f = fakeFrames();
		const loop = createLoop(
			() => {},
			() => false,
			f.frames,
		);
		loop.start();
		f.pump(10);
		loop.gate('offscreen', true);
		f.pump(600); // ten seconds pass with nothing asked of the display
		loop.gate('offscreen', false);
		f.pump(10);
		expect(loop.stats().missed).toBe(0);
	});

	it('waits for start() however the gates report first', () => {
		const f = fakeFrames();
		let drawn = 0;
		const loop = createLoop(
			() => drawn++,
			() => false,
			f.frames,
		);
		loop.gate('hidden', false);
		f.pump(10);
		expect(drawn).toBe(0);
	});

	it('stops for good on stop()', () => {
		const f = fakeFrames();
		let drawn = 0;
		const loop = createLoop(
			() => drawn++,
			() => false,
			f.frames,
		);
		loop.start();
		loop.stop();
		f.pump(10);
		expect(drawn).toBe(0);
	});
});

describe('the page gates', () => {
	let hidden = false;
	Object.defineProperty(document, 'hidden', {
		configurable: true,
		get: () => hidden,
	});
	afterEach(() => (hidden = false));

	it('shuts "hidden" with the tab and opens it again', () => {
		const seen: [Gate, boolean][] = [];
		const stop = watchPage(
			document.createElement('canvas'),
			(g, c) => seen.push([g, c]),
			undefined,
		);
		hidden = true;
		document.dispatchEvent(new Event('visibilitychange'));
		hidden = false;
		document.dispatchEvent(new Event('visibilitychange'));
		stop();
		hidden = true;
		document.dispatchEvent(new Event('visibilitychange'));
		expect(seen).toEqual([
			['hidden', false],
			['hidden', true],
			['hidden', false],
		]);
	});

	it('shuts "offscreen" while the canvas leaves the viewport', () => {
		let report: IntersectionObserverCallback = () => {};
		let watched: Element | null = null;
		let disconnected = false;
		class IO {
			constructor(cb: IntersectionObserverCallback) {
				report = cb;
			}
			observe(el: Element) {
				watched = el;
			}
			disconnect() {
				disconnected = true;
			}
		}
		const canvas = document.createElement('canvas');
		const seen: [Gate, boolean][] = [];
		const stop = watchPage(
			canvas,
			(g, c) => g === 'offscreen' && seen.push([g, c]),
			IO as unknown as typeof IntersectionObserver,
		);
		const entry = (isIntersecting: boolean) =>
			[{ isIntersecting }] as unknown as IntersectionObserverEntry[];
		report(entry(false), {} as IntersectionObserver);
		report(entry(true), {} as IntersectionObserver);
		stop();
		expect(watched).toBe(canvas);
		expect(disconnected).toBe(true);
		expect(seen).toEqual([
			['offscreen', true],
			['offscreen', false],
		]);
	});
});
