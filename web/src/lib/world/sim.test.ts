import { describe, expect, it } from 'vitest';
import { PaceDefaultCdA } from '$lib/protocol';
import { createPace } from '$lib/road/pace';
import { at } from '$lib/road/along';
import { toRoute } from '$lib/road/route';
import { advance, defaultRiders } from './sim';
import { syntheticPoints } from './synthetic';

describe('the dev world rides the shared pace model (#3048)', () => {
	it('lands on the metre the pace model does at every whole second', () => {
		const route = toRoute(syntheticPoints());
		const [you] = defaultRiders(225, 250);
		const twin = createPace(you.v);
		let d = you.d;
		// Frames of a sixth of a second: the world steps on whole seconds only.
		for (let second = 0; second < 30; second++) {
			const before = twin.distance;
			twin.step(225, at(route, d).grade, you.mass, PaceDefaultCdA, 0);
			d += twin.distance - before;
			for (let f = 0; f < 6; f++) advance(route, [you], 1 / 6, second);
			expect(you.d).toBeCloseTo(d + you.v * you.into, 6);
		}
		expect(you.v).toBeCloseTo(twin.speed, 9);
	});
});
