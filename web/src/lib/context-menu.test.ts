import { describe, expect, it } from 'vitest';
import { placeMenu } from '$lib/context-menu.svelte';

describe('placeMenu', () => {
	it('opens at the pointer when there is room', () => {
		expect(placeMenu(100, 100, 200, 150, 1440, 900)).toEqual({
			left: 100,
			top: 100,
		});
	});
	it('flips left and up at the edges, never off screen', () => {
		expect(placeMenu(1400, 880, 200, 150, 1440, 900)).toEqual({
			left: 1200,
			top: 730,
		});
		expect(placeMenu(50, 890, 200, 950, 1440, 900).top).toBe(8);
	});
});
