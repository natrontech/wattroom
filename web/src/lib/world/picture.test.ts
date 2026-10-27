import { describe, expect, it } from 'vitest';
import { legsRoad } from '$lib/road/fixtures';
import { PICTURE, pictureDue } from './picture.svelte';

/** 1.5 km flat, then 1.5 km at 6 %. */
const road = legsRoad([1500, 0], [1500, 6]);

describe('the ride’s picture of the world (#4221)', () => {
	it('waits out the start, climb or no climb', () => {
		expect(pictureDue(road, 2000, PICTURE.settleS - 1)).toBe(false);
	});

	it('is taken on the first climb', () => {
		expect(pictureDue(road, 500, 60)).toBe(false);
		expect(pictureDue(road, 2000, 60)).toBe(true);
	});

	it('takes the road as it is when no climb comes', () => {
		expect(pictureDue(road, 500, PICTURE.fallbackS)).toBe(true);
	});
});
