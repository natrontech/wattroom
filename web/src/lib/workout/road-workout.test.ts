import { describe, expect, it } from 'vitest';
import { packRoad, type Road } from '$lib/road/road';
import { flatten } from './engine';
import { byReference, roadOf, roadSecond } from './road-workout';
import type { Workout } from './types';

const road: Road = {
	length: 2000,
	heights: Array.from({ length: 101 }, (_, i) => 100 + 0.4 * i),
	turns: Array<number>(100).fill(0),
};
const profile = btoa(String.fromCharCode(...packRoad(road)));
const pinned: Workout = {
	name: 'Road · 2.0 km',
	steps: [
		{ type: 'steady', seconds: 200, target: 0.7 },
		{ type: 'steady', seconds: 300, target: 0.8 },
	],
	road: {
		routeId: '00000000-0000-0000-0000-000000000001',
		fromM: 0,
		toM: 2000,
		stepEndM: [800, 2000],
		profile,
		originM: 0,
	},
};

describe('a road workout (#3499)', () => {
	it('puts the rider through each block in step with its metres', () => {
		const segments = flatten(pinned);
		const road = pinned.road!;
		const at = (m: number) =>
			roadSecond(segments, { fromM: road.fromM, stepEndM: road.stepEndM! }, m);
		expect(at(0)).toBe(0);
		expect(at(400)).toBe(100); // half of the first block's 800 m
		expect(at(800)).toBe(200); // the second block's first metre
		expect(at(1400)).toBe(350); // half of the second block's 1200 m
		expect(at(2000)).toBe(500); // the end
		expect(at(9999)).toBe(500);
	});

	it('rides only a pinned road that came back with its profile', () => {
		expect(roadOf(pinned)?.road.length).toBe(2000);
		const { profile: _, ...bare } = pinned.road!;
		expect(roadOf({ ...pinned, road: bare })).toBeNull();
		expect(
			roadOf({ ...pinned, road: { ...pinned.road!, stepEndM: undefined } }),
		).toBeNull();
		expect(roadOf({ name: 'x', steps: [] })).toBeNull();
	});

	it('goes back up by reference only', () => {
		const sent = byReference(pinned);
		expect(sent.road).toEqual({
			routeId: pinned.road!.routeId,
			fromM: 0,
			toM: 2000,
			stepEndM: [800, 2000],
		});
		expect(byReference({ name: 'x', steps: [] })).toEqual({
			name: 'x',
			steps: [],
		});
	});
});
