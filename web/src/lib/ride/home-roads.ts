import type { Route } from '#lib/road/route.ts';
import type { Shape } from '#lib/world/synthetic.ts';
import type { RideableRoute } from '#lib/ride/roads.ts';
import type { StoredRoute } from '#lib/road/stored.ts';

/**
 * WattRoom's own roads (#4248): made-up loops every rider has, crew or none,
 * generated here from invented corners (no real track, no ODbL, nothing of
 * ADR-0063's), each shaped to bring out what the world puts beside a road.
 * Ridden as a borrowed road, as the first-run road always was: the ride
 * saves as a free ride, with no route row to save against.
 */
export type HomeRoad = {
	id: string;
	/**
	 * The id a session rides it under: the server holds a frozen copy of the
	 * road this builds (server/internal/routes/library), so a crew can ride
	 * it together. Never changes.
	 */
	routeId: string;
	name: string;
	/** What is along it, in a line. */
	story: string;
	shape: () => Promise<Shape>;
	/** False: still ridden by its id, offered by no list. */
	listed?: boolean;
};

export const HOME_ROADS: readonly HomeRoad[] = [
	{
		id: 'intro',
		routeId: '7a77b0ad-0001-4000-8000-000000004248',
		name: 'Pass loop',
		// Col de Berne took its place: a session that rides it still finds it, no list offers it.
		listed: false,
		story:
			'A valley, five hairpins with their mirrors, and a pass with its hut, flags and summit cross.',
		shape: async () => (await import('#lib/world/synthetic.ts')).PASS_LOOP,
	},
	{
		id: 'valley',
		routeId: '7a77b0ad-0002-4000-8000-000000004248',
		name: 'Valley loop',
		story:
			'Rolling farmland and villages, cows by the road, two bridges over the river and two short steep ramps.',
		shape: () => designed('valley'),
	},
	// The map (world/designs.ts): one land, and five loops through it from its village, by the time they take.
	{
		id: 'urnsee',
		routeId: '7a77b0ad-0005-4000-8000-000000004248',
		name: 'Urnsee-Rundfahrt',
		story:
			'Half an hour round a mountain lake: under the cliffs of the east shore through a gallery, a bridge over an inlet, and a terrace high over the west.',
		shape: () => designed('urnsee'),
	},
	{
		id: 'aare',
		routeId: '7a77b0ad-0004-4000-8000-000000004248',
		name: 'Tour de l’Aaren',
		story:
			'Forty minutes round the river’s gorge: over a spur, two high bridges, and the moor on the plateau.',
		shape: () => designed('aare'),
	},
	{
		id: 'lac',
		routeId: '7a77b0ad-0006-4000-8000-000000004248',
		name: 'Flèche du Lac',
		story:
			'An hour: the lake first, then the gorge, through the village between them.',
		shape: () => designed('lac'),
	},
	{
		id: 'berne',
		routeId: '7a77b0ad-0003-4000-8000-000000004248',
		name: 'Col de Berne',
		story:
			'Ninety minutes: twenty-one hairpins up into the snow to a notch between two peaks, down the north side past a tarn, and home along the lake.',
		shape: () => designed('berne'),
	},
	{
		id: 'kette',
		routeId: '7a77b0ad-0007-4000-8000-000000004248',
		name: 'Kettental-Runde',
		story:
			'Two hours: the lake shore and its tunnel, a Z of hairpins up to the alp and its lake, the ridge over Speichenegg, down into the Kettental’s fields and home over the gorge.',
		shape: () => designed('kette'),
	},
];

/** A designed road's corners (world/designs.ts), loaded with the world's own chunk. */
async function designed(id: string): Promise<Shape> {
	const { DESIGNS } = await import('#lib/world/designs.ts');
	return DESIGNS.find((d) => d.id === id)!.shape;
}

/** One of WattRoom's roads, by its own id or the id a session rides it under. */
/** The roads a list offers. */
export const LISTED_ROADS: readonly HomeRoad[] = HOME_ROADS.filter(
	(r) => r.listed !== false,
);

export const homeRoad = (id: string) =>
	HOME_ROADS.find((r) => r.id === id || r.routeId === id);

/** The roads a search keeps: by name or by what is along it. */
export function homeRoadsMatching(query: string): readonly HomeRoad[] {
	const q = query.trim().toLowerCase();
	if (!q) return LISTED_ROADS;
	return LISTED_ROADS.filter(
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
		import('#lib/road/climbs.ts'),
		import('#lib/road/profile.ts'),
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

// Built once: the shelf, the road’s page and its ride all read this one.
const built = new Map<string, Promise<Route>>();
function build(road: HomeRoad): Promise<Route> {
	let route = built.get(road.id);
	if (!route) {
		route = Promise.all([
			import('#lib/road/route.ts'),
			import('#lib/world/synthetic.ts'),
			road.shape(),
		]).then(([{ toRoute }, { syntheticPoints }, shape]) =>
			toRoute(syntheticPoints(shape)),
		);
		// A chunk that failed to load is asked for again next time.
		route.catch(() => built.delete(road.id));
		built.set(road.id, route);
	}
	return route;
}

/** One of WattRoom's roads, built here, ready to ride. */
export async function homeRoute(road: HomeRoad): Promise<RideableRoute> {
	const route = await build(road);
	return {
		id: road.id,
		name: road.name,
		road: route.road,
		loop: route.loop,
		borrowed: true,
	};
}

/** Its map, for the road's own page (#4257): invented, so anyone may see it. */
export async function homeShape(
	road: HomeRoad,
): Promise<{ x: number[]; z: number[] }> {
	const { x, z } = await build(road);
	return { x: Array.from(x), z: Array.from(z) };
}

/**
 * WattRoom's roads as a session's pickers list them (#4258): their rows,
 * under the ids the server rides them by, ahead of the rider's own.
 */
export async function wattroomRoads(): Promise<StoredRoute[]> {
	const rows = await Promise.all(LISTED_ROADS.map(homeRow));
	return rows.map((row, i) => ({ ...row, id: LISTED_ROADS[i].routeId }));
}
