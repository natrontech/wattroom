import { describe, expect, it } from 'vitest';
import { hairpinsOf } from '$lib/road/climbs';
import { legsRoad } from '$lib/road/fixtures';
import type { Road } from '$lib/road/road';
import { routeOfRoad } from './road-route';
import {
	bestMoment,
	momentToDraw,
	PICTURE,
	type PictureMoment,
	worldPicture,
} from './picture.svelte';

/** Ridden past each metre in turn, the light and watts rising as it went. */
const ride = (...ms: number[]): PictureMoment[] =>
	ms.map((m, k) => ({ m, p: k / ms.length, watts: 200 + k }));

/** `road` with a half turn of 180° over 200 m from metre `from`: a hairpin. */
function withHairpin(road: Road, from: number): Road {
	const turns = [...road.turns];
	for (let k = 0; k < 10; k++) turns[from / 20 + k] = 18;
	return { ...road, turns };
}

describe('the ride’s best moment for its picture (#4263)', () => {
	it('is the summit you crossed, just below its top, over a hairpin and a steeper ramp', () => {
		// 1 km flat, a hairpin, 1 km at 7 % to a top at 2 km, then down.
		const road = withHairpin(legsRoad([1000, 0], [1000, 7], [1000, -5]), 400);
		const route = routeOfRoad(road);
		const top = route.climbs.at(-1)!.topM;
		const moment = bestMoment(route, ride(300, 900, 1500, 1990, 2010, 2400));
		expect(moment?.m).toBe(top - PICTURE.belowTopM);
		// The light and watts are the moment's own, not the ride's end.
		expect(moment?.watts).toBe(202);
	});

	it('is the hairpin you rode through when you crossed no summit', () => {
		const road = withHairpin(legsRoad([3000, 0]), 1000);
		const [hairpin] = hairpinsOf(road);
		expect(hairpin).toBeGreaterThan(1000);
		const moment = bestMoment(routeOfRoad(road), ride(600, 900, 1100, 1600));
		expect(moment?.m).toBe(hairpin);
	});

	it('finds the hairpin a lap’s seam lies across, on a road the session laps', () => {
		const road = withHairpin(legsRoad([3000, 0]), 0);
		const [hairpin] = hairpinsOf(road);
		const route = { ...routeOfRoad(road), loop: true };
		// Metres count on past the lap: the last pair spans its end and the next one's start.
		const moment = bestMoment(route, ride(2700, 2950, 3000 + hairpin + 20));
		expect(moment?.m).toBe(hairpin);
	});

	it('is the steepest stretch you rode on a road with neither', () => {
		const route = routeOfRoad(legsRoad([1000, 2], [500, 9], [1000, 3]));
		const moment = bestMoment(route, ride(500, 900, 1200, 1400, 1800));
		expect(moment?.m).toBe(1200);
	});

	it('leaves a summit you never reached out', () => {
		const route = routeOfRoad(legsRoad([1000, 0], [1000, 7], [1000, -5]));
		const moment = bestMoment(route, ride(300, 900, 1500));
		expect(moment?.m).toBe(1500);
	});

	it('is the moment the rider took, over the best one (#4253)', () => {
		const route = routeOfRoad(legsRoad([1000, 0], [1000, 7], [1000, -5]));
		const took = { m: 600, p: 0.2, watts: 180 };
		const ridden = ride(300, 900, 1500, 1990, 2010, 2400);
		expect(momentToDraw(took, route, ridden)).toEqual(took);
		expect(momentToDraw(null, route, ridden)?.m).toBe(
			route.climbs.at(-1)!.topM - PICTURE.belowTopM,
		);
	});

	it('draws nothing of a ride that never settled', () => {
		expect(bestMoment(routeOfRoad(legsRoad([1000, 4])), [])).toBeNull();
	});
});

describe('the picture as the world draws it (#4263)', () => {
	it('keeps what it drew, and lets a late one go once a new ride starts', async () => {
		worldPicture.clear();
		const late = Promise.withResolvers<Blob | null>();
		const drawing = worldPicture.draw(late.promise);
		expect(worldPicture.drawing).toBe(true);
		worldPicture.clear();
		late.resolve(new Blob(['old']));
		await drawing;
		expect(worldPicture.current).toBeNull();
		const shot = new Blob(['new']);
		await worldPicture.draw(Promise.resolve(shot));
		expect(worldPicture.drawing).toBe(false);
		expect(worldPicture.current).toBe(shot);
		worldPicture.clear();
	});
});
