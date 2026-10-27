import { describe, expect, it } from 'vitest';
import { toRoute } from '$lib/road/route';
import { syntheticPoints } from './synthetic';
import { generate } from './world';
import { BUILD_MS } from './world.test-helper';
import { HOME_ROADS, homeRoadsMatching, homeRow } from '$lib/ride/home-roads';
import { loadRoad } from '$lib/ride/roads';

describe('WattRoom’s own roads (#4248)', () => {
	it.each(HOME_ROADS)(
		'$name reads as a route row measured off its own road',
		async (home) => {
			const route = toRoute(syntheticPoints(await home.shape()));
			const row = await homeRow(home);
			expect(row.lengthM).toBe(route.road.length);
			expect(row.gainM).toBeGreaterThan(0);
			// Each one climbs something worth a class chip on its row.
			expect(row.climbs.some((c) => c.cls)).toBe(true);
		},
	);

	it('rides each one by its id, built here, as a borrowed road', async () => {
		for (const home of HOME_ROADS) {
			const res = await loadRoad(home.id);
			expect(res.ok && res.route.borrowed && res.route.name).toBe(home.name);
		}
	});

	it(
		'gives the valley loop its farms, cattle signs, milk cans and steep signs',
		async () => {
			const valley = HOME_ROADS.find((r) => r.id === 'valley')!;
			const world = generate(toRoute(syntheticPoints(await valley.shape())));
			const n = (k: string) => world.pieces.filter((p) => p.kind === k).length;
			expect(n('house')).toBeGreaterThan(0);
			expect(n('cattle')).toBeGreaterThan(0);
			expect(n('milkcans')).toBeGreaterThan(0);
			expect(n('steep')).toBeGreaterThan(0);
		},
		BUILD_MS,
	);

	it('keeps to what a search matches, by name or by what is along it', () => {
		expect(homeRoadsMatching('').length).toBe(HOME_ROADS.length);
		expect(homeRoadsMatching('valley').map((r) => r.id)).toContain('valley');
		expect(homeRoadsMatching('cows').map((r) => r.id)).toEqual(['valley']);
		expect(homeRoadsMatching('swells')).toEqual([]);
	});
});
