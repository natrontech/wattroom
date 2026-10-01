import { describe, expect, it } from 'vitest';
import { packRoad, type Road } from '$lib/road/road';
import { flatten } from './engine';
import {
	bandOf,
	byReference,
	roadOf,
	roadSecond,
	skylineOf,
} from './road-workout';
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

	it('rides a road that came back with its profile, pinned or not (#3594)', () => {
		expect(roadOf(pinned)?.stepEndM).toEqual([800, 2000]);
		const { profile: _, ...bare } = pinned.road!;
		expect(roadOf({ ...pinned, road: bare })).toBeNull();
		// Any workout on a route (#3100): ridden, with no pins to end its blocks.
		const unpinned = roadOf({
			...pinned,
			road: { ...pinned.road!, stepEndM: undefined },
		});
		expect(unpinned?.road.length).toBe(2000);
		expect(unpinned?.stepEndM).toBeUndefined();
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

describe('the Skyline on a road workout (#3641)', () => {
	const segments = flatten({
		name: 'three blocks',
		steps: [
			{ type: 'steady', seconds: 300, target: 0.5 },
			{ type: 'steady', seconds: 300, target: 1.0 },
			{ type: 'steady', seconds: 300, target: 0.6 },
		],
	});

	it("lays a pinned road's blocks along it, each in its graph zone", () => {
		expect(bandOf(segments, 100, [800, 1500, 2000], 200)).toEqual([
			{ fromM: 100, toM: 800, zone: 1 },
			{ fromM: 800, toM: 1500, zone: 4 },
			{ fromM: 1500, toM: 2000, zone: 2 },
		]);
	});

	it('has no band where the clock ends the blocks', () => {
		expect(bandOf(segments, 0, undefined, 200)).toEqual([]);
	});

	it('draws the road the dot rides, and nothing off a road', () => {
		expect(skylineOf(null, segments, 200)).toBeNull();
		const view = skylineOf(
			{ road, along: 420, mps: 7, startM: 0, blockEndsM: [800, 1500, 2000] },
			segments,
			200,
		);
		expect(view).toMatchObject({ road, m: 420, mps: 7 });
		expect(view?.band).toHaveLength(3);
	});
});
