import type { TrackPoint } from '$lib/road/parse';
import { toRoute } from '$lib/road/route';
import { landUse } from './land';
import { createTerrain, gridAt, placeLevel } from './terrain-mesh';
import { makeGround } from './terrain/ground';
import type { Line } from './terrain/lines';
import { drawnRows } from './terrain/road-profile';
import { DEV_SALT } from './world';

/**
 * A route's ground as a world builds it, without the props: what the
 * streamed ground is asked of, on the page or in the worker (#3606).
 * Test-only: nothing in the app imports it.
 */
export function placeOf(points: TrackPoint[]) {
	const route = toRoute(points);
	const rows = drawnRows(route);
	const roads: Line[] = [
		{
			key: 'route',
			x: rows.map((p) => p.x),
			z: rows.map((p) => p.z),
			h: rows.map((p) => p.ele),
		},
	];
	const ground = makeGround(roads, { salt: DEV_SALT });
	const land = landUse(ground.noise);
	const level = placeLevel(ground.lines);
	const terrain = createTerrain(ground, level, land);
	return {
		route,
		roads,
		salt: DEV_SALT,
		level,
		grid: terrain.chunk,
		peek: terrain.peek,
		gridAt: (
			ci: number,
			cj: number,
			at: Parameters<typeof gridAt>[4],
			edges: Parameters<typeof gridAt>[5],
		) => gridAt(ground, land, ci, cj, at, edges),
	};
}
