import { describe, expect, it } from 'vitest';
import { peaksOf } from '$lib/sound/peaks';

describe('peaksOf', () => {
	it('takes the loudest sample per bucket and normalises to the loudest bucket', () => {
		expect(peaksOf(new Float32Array([0, 0.5, -1, 0.25]), 2)).toEqual([0.5, 1]);
	});

	it('leaves silence flat rather than dividing by zero', () => {
		expect(peaksOf(new Float32Array([0, 0, 0, 0]), 2)).toEqual([0, 0]);
	});

	it('draws as many bars as asked, even past the samples', () => {
		expect(peaksOf(new Float32Array([1, 1]), 4)).toHaveLength(4);
	});
});
