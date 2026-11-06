import { describe, expect, it } from 'vitest';
import { plantStage } from '$lib/lounge/memory';

describe('what the room remembers', () => {
	it('grows the plant with the sessions ridden together', () => {
		expect([0, 1, 4, 5, 19, 20, 50, 900].map(plantStage)).toEqual([
			0, 1, 1, 2, 2, 3, 4, 4,
		]);
	});
});
