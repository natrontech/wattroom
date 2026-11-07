import { describe, expect, it } from 'vitest';
import { stretchesFor } from './roadside';

describe('the roadside’s stretches', () => {
	it('stands what is ahead within reach and a little behind, nearest first', () => {
		expect(stretchesFor(1000, 100_000, false)).toEqual([3, 4, 5, 2]);
	});

	it('keeps a few stretches on a long road, never the whole of it', () => {
		expect(stretchesFor(50_000, 200_000, false).length).toBeLessThanOrEqual(4);
	});

	it('stops at the road’s ends', () => {
		expect(stretchesFor(0, 100_000, false)).toEqual([0, 1]);
		expect(stretchesFor(99_900, 100_000, false)).toEqual([333, 332]);
	});

	it('wraps a loop round to its start', () => {
		expect(stretchesFor(5900, 6000, true)).toEqual([19, 0, 1]);
		expect(stretchesFor(6050, 6000, true)).toEqual([0, 1, 19]);
	});

	it('takes the start for a rider with no place yet', () => {
		expect(stretchesFor(-Infinity, 6000, false)).toEqual([0, 1]);
	});
});
