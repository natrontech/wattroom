import { describe, expect, it } from 'vitest';
import { appeared, flickers, hidden } from './world-ids-measure';

const ids = (...v: number[]) => Uint32Array.from(v);
/** Instance 1 of object 5. */
const I = 5 + 0x10000;

describe('appeared', () => {
	const cases: {
		name: string;
		held: [number, number][];
		shown: [number, number][];
		before: number[];
		after: number[];
		minPx: number;
		want: [number, number][];
	}[] = [
		{
			name: 'an instance shown from nothing is a pop',
			held: [],
			shown: [[I, 0]],
			before: [1, 1, 1, 1],
			after: [I, I, I, 1],
			minPx: 2,
			want: [[I, 3]],
		},
		{
			name: 'one held out of sight comes in without popping',
			held: [[I, 0]],
			shown: [[I, 0]],
			before: [1, 1, 1, 1],
			after: [I, I, I, 1],
			minPx: 0,
			want: [],
		},
		{
			name: 'a model swapped in place counts only what its outline gained',
			held: [[I, 0]],
			shown: [[I, 1]],
			before: [I, I, 1, 1],
			after: [I, I, I, 1],
			minPx: 0,
			want: [[I, 1]],
		},
		{
			name: 'at the limit is no pop',
			held: [],
			shown: [[I, 0]],
			before: [1, 1, 1, 1],
			after: [I, I, 1, 1],
			minPx: 2,
			want: [],
		},
	];
	it.each(cases)('$name', ({ held, shown, before, after, minPx, want }) => {
		const got = appeared(
			new Map(held),
			new Map(shown),
			ids(...before),
			ids(...after),
			minPx,
		);
		expect([...got]).toEqual(want);
	});
});

describe('flickers', () => {
	it.each([
		{ name: 'still', a: [1, 2], b: [1, 2], c: [1, 2], want: 0 },
		{ name: 'an edge sweeping once', a: [1, 1], b: [2, 1], c: [2, 2], want: 0 },
		{
			name: 'a pixel flipping and back',
			a: [1, 1],
			b: [2, 1],
			c: [1, 1],
			want: 1,
		},
	])('$name: $want', ({ a, b, c, want }) => {
		expect(flickers(ids(...a), ids(...b), ids(...c))).toBe(want);
	});
});

describe('hidden', () => {
	// Two pixels wide, rows bottom up: you (7) over rows 0–3, the road (3) over your lowest row, your ring (8) beside it.
	const mask = ids(7, 7, 7, 0, 7, 0, 7, 0);
	const full = ids(3, 8, 7, 0, 7, 0, 9, 0);

	it('names what is not you, with how far up it reaches', () => {
		const { px, by } = hidden(full, mask, new Set([7, 8]), 2);
		expect(px).toBe(5);
		expect([...by]).toEqual([
			[3, { px: 1, reach: 0 }],
			[9, { px: 1, reach: 1 }],
		]);
	});

	it('counts an instance of you as you', () => {
		const { by } = hidden(ids(7 + 0x20000), ids(7), new Set([7]), 1);
		expect(by.size).toBe(0);
	});
});
