import { describe, expect, it, vi } from 'vitest';

const clear = vi.hoisted(() => vi.fn());
vi.mock('./picture.svelte', () => ({ worldPicture: { clear } }));

import { momentsFor } from './ride-moments';

describe('momentsFor (ADR-0093 point 10)', () => {
	it('keeps a ride’s moments and picture when its world opens again, and starts the next ride with neither', () => {
		const ride = {};
		const first = momentsFor(ride);
		first.ridden.push({ m: 120, p: null, watts: 210 });
		expect(clear).toHaveBeenCalledTimes(1);

		const again = momentsFor(ride);
		expect(again.ridden).toHaveLength(1);
		expect(
			clear,
			'the world’s mount cleared the picture',
		).toHaveBeenCalledTimes(1);

		const next = momentsFor({});
		expect(next.ridden).toEqual([]);
		expect(clear).toHaveBeenCalledTimes(2);
	});

	it('takes a world with no ride to name as a ride of its own', () => {
		clear.mockClear();
		momentsFor(undefined).ridden.push({ m: 5, p: null, watts: 100 });
		expect(momentsFor(undefined).ridden).toEqual([]);
		expect(clear).toHaveBeenCalledTimes(2);
	});
});
