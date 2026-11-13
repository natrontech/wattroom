import { turnedRound, type Road } from '#lib/road/road.ts';
import type { Route } from '#lib/road/route.ts';
import { designedFor, designedLine } from './designed';
import type { MapData } from './map-render';
import MAP_JSON from './wattalp-map.json';

/** The map's picture's data (map-render.ts): its rectangle, its roads and names. */
export const WATTALP = MAP_JSON as MapData;

/**
 * Where a road lies on the Wattalp map: the line it is drawn on there, and
 * whether it is ridden from its far end (then metre m of the road is metre
 * length − m of the line). Undefined for any road that is not one of the
 * map's loops: a rider's own, the Pass loop, the Valley loop.
 */
export function onWattalp(
	road: Road,
): { line: Route; reverse: boolean } | undefined {
	for (const reverse of [false, true]) {
		const d = designedFor(reverse ? turnedRound(road) : road);
		if (d && WATTALP.loops.includes(d.id))
			return { line: designedLine(d), reverse };
	}
	return undefined;
}
