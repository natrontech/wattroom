import { test } from '@playwright/test';
import {
	bigWatts,
	designCrew,
	fixtureRoad,
	joinCrew,
	ownWorkout,
	planTwo,
	savedRide,
} from './design/seed';
import { DESK, OUT, Shoot } from './design/shoot';

/**
 * The design shots' world, made before any surface is shot (#3858): the
 * `design` project depends on this one. Every surface then sees the same
 * crew, roads, workouts and rides whichever others a run names and in
 * whatever order they run — a crew founded halfway through a run used to
 * change the sidebar of every shot after it.
 */

test.skip(!OUT, 'the design shots run through `make design-shots`');

test('seed', async ({ browser }) => {
	const s = new Shoot(browser, 'seed', 'dark');
	try {
		const designer = (await s.open(DESK)).page;
		const hairpin = await fixtureRoad(designer, 'hairpin');
		await fixtureRoad(designer, 'rolling');
		await ownWorkout(designer);
		await bigWatts(designer);
		await savedRide(designer);
		await savedRide(designer, hairpin);
		const crew = await designCrew(designer);
		await planTwo(designer, crew);
		for (const as of ['Design Partner', 'Design Watcher'])
			await joinCrew((await s.open(DESK, { as })).page, crew.code);
		// Riders that exist and have done nothing: no ride, no crew.
		for (const as of ['Newcomer', 'Hud Watcher']) await s.open(DESK, { as });
	} finally {
		await s.close();
	}
});
