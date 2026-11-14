import { turnedRound, type Road } from '#lib/road/road.ts';
import type { Route } from '#lib/road/route.ts';
import { designedFor, designedLine } from './designed';
import { landOf, LANDS } from './designs';
import type { MapData } from './map-render';

/** A land's map: its picture's data (map-render.ts), its rectangle, its roads and names, and the picture itself. */
export type LandMapOf = { data: MapData; picture: string };

// Every land's picture and data, by the file names map-render.golden.test.ts writes: `<land>-map.png`, `<land>-map.json`.
const DATA = import.meta.glob<MapData>('./*-map.json', {
	eager: true,
	import: 'default',
});
const PICTURES = import.meta.glob<string>('./*-map.png', {
	eager: true,
	import: 'default',
});

/** Each land's map, by the land's id. */
export const MAPS: Readonly<Record<string, LandMapOf>> = Object.fromEntries(
	LANDS.flatMap((land) => {
		const data = DATA[`./${land.id}-map.json`];
		const picture = PICTURES[`./${land.id}-map.png`];
		return data && picture ? [[land.id, { data, picture }]] : [];
	}),
);

/** The map a designed loop is drawn on, by the loop's id (a route's scene): undefined for a road with no land of its own. */
export function mapOf(id: string | undefined): LandMapOf | undefined {
	const land = landOf(id);
	return land && MAPS[land.id];
}

/**
 * Where a road lies on its land's map: the map, the line the road is drawn
 * on there, and whether it is ridden from its far end (then metre m of the
 * road is metre length − m of the line). Undefined for any road that is not
 * one of a land's loops: a rider's own, the Pass loop.
 */
export function onLandMap(
	road: Road,
): { map: LandMapOf; line: Route; reverse: boolean } | undefined {
	for (const reverse of [false, true]) {
		const d = designedFor(reverse ? turnedRound(road) : road);
		const map = d && mapOf(d.id);
		if (d && map) return { map, line: designedLine(d), reverse };
	}
	return undefined;
}
