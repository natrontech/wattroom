import { describe, expect, it } from 'vitest';
import { legible } from '$lib/lounge/draw-rider';
import { halved, pedalFrame, seenFrom, stepDownFor } from './avatar';

const INK = [8, 1, 15] as const;
const pixels = (rows: (number[] | null)[]): Uint8ClampedArray => {
	const out = new Uint8ClampedArray(rows.length * 4);
	rows.forEach((c, i) => {
		if (c) out.set([...c, 255], i * 4);
	});
	return out;
};

describe('a rider seen from where the camera is', () => {
	it('shows their back to a camera behind them, their front to one ahead', () => {
		expect(seenFrom(0, 0, 10).view).toBe('back');
		expect(seenFrom(0, 0, -10).view).toBe('front');
	});
	it('shows their side to a camera beside them, and turns them to where they go', () => {
		expect(seenFrom(0, 10, 0)).toEqual({ view: 'side', flip: true });
		expect(seenFrom(0, -10, 0)).toEqual({ view: 'side', flip: false });
	});
	it('takes the quarter views between', () => {
		expect(seenFrom(0, 10, 10).view).toBe('quarter');
		expect(seenFrom(0, 10, -10).view).toBe('nose');
	});
	it('follows the road round a bend', () => {
		expect(seenFrom(Math.PI / 2, 10, 0).view).toBe('back');
	});
});

describe('the pedal stroke', () => {
	it('walks eight frames a turn, and wraps', () => {
		const turn = Math.PI * 2;
		expect([0, 0.25, 0.5, 0.75].map((t) => pedalFrame(t * turn))).toEqual([
			0, 2, 4, 6,
		]);
		expect(pedalFrame(turn * 7.1)).toBe(0);
		expect(pedalFrame(-turn * 0.1)).toBe(7);
	});
});

describe('legs on a dark road', () => {
	it('lifts dark trousers, and leaves bright ones alone', () => {
		expect(legible('#3a78c8')).toBe('#3a78c8');
		const lifted = parseInt(legible('#120a22').slice(1), 16);
		expect((lifted >> 16) & 255).toBeGreaterThan(0x12);
		expect(lifted & 255).toBeGreaterThan(0x22);
	});
});

describe('a sprite further off', () => {
	it('steps down in whole sizes, so a pixel is never scaled', () => {
		expect([40, 20, 19, 9, 8, 1].map(stepDownFor)).toEqual([1, 1, 2, 2, 4, 4]);
	});

	it('keeps a colour over its outline', () => {
		const red = [200, 10, 10];
		const out = halved(pixels([[...INK], red, [...INK], [...INK]]), 2, 2, INK);
		expect([...out]).toEqual([200, 10, 10, 255]);
	});
	it('never blends two colours', () => {
		const out = halved(
			pixels([[200, 10, 10], [200, 10, 10], [10, 10, 200], null]),
			2,
			2,
			INK,
		);
		expect([...out]).toEqual([200, 10, 10, 255]);
	});
	it('keeps an outline that is all there is', () => {
		const out = halved(pixels([[...INK], [...INK], null, null]), 2, 2, INK);
		expect([...out]).toEqual([...INK, 255]);
	});
	it('lets a mostly empty block go', () => {
		const out = halved(pixels([[9, 9, 9], null, null, null]), 2, 2, INK);
		expect(out[3]).toBe(0);
	});
});
