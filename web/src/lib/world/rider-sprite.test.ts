import { describe, expect, it } from 'vitest';
import { legible } from '$lib/lounge/draw-rider';
import { halved } from './rider-sprite';

const INK = [8, 1, 15] as const;
const pixels = (rows: (number[] | null)[]): Uint8ClampedArray => {
	const out = new Uint8ClampedArray(rows.length * 4);
	rows.forEach((c, i) => {
		if (c) out.set([...c, 255], i * 4);
	});
	return out;
};

describe('legs on a dark road', () => {
	it('lifts dark trousers, and leaves bright ones alone', () => {
		expect(legible('#3a78c8')).toBe('#3a78c8');
		const lifted = parseInt(legible('#120a22').slice(1), 16);
		expect((lifted >> 16) & 255).toBeGreaterThan(0x12);
		expect(lifted & 255).toBeGreaterThan(0x22);
	});
});

describe('a sprite further off', () => {
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
