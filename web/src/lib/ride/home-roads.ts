import type { Corner, Shape } from '$lib/world/synthetic';
import type { RideableRoute } from '$lib/ride/roads';
import type { StoredRoute } from '$lib/road/stored';

/**
 * WattRoom's own roads (#4248): made-up loops every rider has, crew or none,
 * generated here from invented corners (no real track, no ODbL, nothing of
 * ADR-0063's), each shaped to bring out what the world puts beside a road.
 * Ridden as a borrowed road, as the first-run road always was: the ride
 * saves as a free ride, with no route row to save against.
 */
export type HomeRoad = {
	id: string;
	name: string;
	/** What is along it, in a line. */
	story: string;
	shape: () => Promise<Shape>;
};

/**
 * Rolling farmland at about 520–630 m: meadows, so farms with their cows,
 * milk cans and cattle signs; two short ramps steep enough for the
 * steep-road sign. About 16 km, 130 m up.
 */
const VALLEY_LOOP: Corner[] = [
	{ x: 0, y: 0, ele: 520, r: 200 },
	{ x: 2500, y: 0, ele: 522, r: 150 },
	{ x: 2800, y: 0, ele: 549, r: 60 },
	{ x: 4500, y: 800, ele: 560, r: 250 },
	{ x: 5000, y: 2500, ele: 540, r: 200 },
	{ x: 4200, y: 3600, ele: 600, r: 60 },
	{ x: 3900, y: 3800, ele: 630, r: 40 },
	{ x: 2500, y: 4300, ele: 600, r: 250 },
	{ x: 800, y: 3800, ele: 560, r: 250 },
	{ x: -600, y: 2600, ele: 535, r: 300 },
	{ x: -500, y: 1000, ele: 522, r: 250 },
];

export const HOME_ROADS: readonly HomeRoad[] = [
	{
		id: 'intro',
		name: 'Pass loop',
		story:
			'A valley, five hairpins with their mirrors, and a pass with its hut, flags and summit cross.',
		shape: async () => (await import('$lib/world/synthetic')).PASS_LOOP,
	},
	{
		id: 'valley',
		name: 'Valley loop',
		story:
			'Rolling farmland and villages, cows by the road, and two short steep ramps.',
		shape: async () => ({ corners: VALLEY_LOOP, seed: 4248 }),
	},
];

export const homeRoad = (id: string) => HOME_ROADS.find((r) => r.id === id);

/** The roads a search keeps: by name or by what is along it. */
export function homeRoadsMatching(query: string): readonly HomeRoad[] {
	const q = query.trim().toLowerCase();
	if (!q) return HOME_ROADS;
	return HOME_ROADS.filter(
		(r) =>
			r.name.toLowerCase().includes(q) || r.story.toLowerCase().includes(q),
	);
}

/**
 * One of WattRoom's roads as the shared route row reads a route (#4248): its
 * length, gain and classed climbs measured off the road it builds, never
 * written by hand.
 */
export async function homeRow(home: HomeRoad): Promise<StoredRoute> {
	const [route, { climbsOf }, { gainOf }] = await Promise.all([
		homeRoute(home),
		import('$lib/road/climbs'),
		import('$lib/road/profile'),
	]);
	return {
		id: home.id,
		name: home.name,
		generatedName: home.name,
		src: 'wattroom',
		lengthM: route.road.length,
		gainM: Math.round(gainOf(route.road.heights)),
		climbs: climbsOf(route.road),
		hasPlace: false,
		ownerOnly: false,
		createdAt: '',
	};
}

/** One of WattRoom's roads, built here, ready to ride. */
export async function homeRoute(road: HomeRoad): Promise<RideableRoute> {
	const [{ toRoute }, { syntheticPoints }, shape] = await Promise.all([
		import('$lib/road/route'),
		import('$lib/world/synthetic'),
		road.shape(),
	]);
	const route = toRoute(syntheticPoints(shape));
	return {
		id: road.id,
		name: road.name,
		road: route.road,
		loop: route.loop,
		borrowed: true,
	};
}
