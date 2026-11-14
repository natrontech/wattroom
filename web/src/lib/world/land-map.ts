import { turnedRound, type Road } from '#lib/road/road.ts';
import type { Route } from '#lib/road/route.ts';
import { designedFor, designedLine } from './designed';
import { landOf, LANDS, type Bounds } from './designs';
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

/** A rectangle of a map in the world's frame (x east, z south, metres): what its picture's viewBox shows. */
export type MapBox = { x: number; z: number; w: number; h: number };

/** The whole land. */
export const landBox = (b: Bounds): MapBox => ({
	x: b.west,
	z: -b.north,
	w: b.east - b.west,
	h: b.north - b.south,
});

/** The land round the loop on the ride's zoomed Map, each side, as a share of the loop's size: enough to see where the loop runs. */
export const LOOP_MARGIN = 0.15;

/**
 * The ride's Map zoomed to the loop being ridden: the loop's box with
 * LOOP_MARGIN of land round it, widened to the screen's shape (`aspect`,
 * width over height) so the land fills the screen, and moved inside the land
 * where it would run off it. A side longer than the land's is the land's.
 */
export function loopBox(
	line: { x: ArrayLike<number>; z: ArrayLike<number> },
	bounds: Bounds,
	aspect: number,
): MapBox {
	let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
	for (let i = 0; i < line.x.length; i++) {
		x0 = Math.min(x0, line.x[i]);
		x1 = Math.max(x1, line.x[i]);
		z0 = Math.min(z0, line.z[i]);
		z1 = Math.max(z1, line.z[i]);
	}
	let w = (x1 - x0) * (1 + 2 * LOOP_MARGIN);
	let h = (z1 - z0) * (1 + 2 * LOOP_MARGIN);
	if (w / h < aspect) w = h * aspect;
	else h = w / aspect;
	const land = landBox(bounds);
	w = Math.min(w, land.w);
	h = Math.min(h, land.h);
	const clamp = (v: number, lo: number, hi: number) =>
		Math.min(hi, Math.max(lo, v));
	return {
		x: clamp((x0 + x1 - w) / 2, land.x, land.x + land.w - w),
		z: clamp((z0 + z1 - h) / 2, land.z, land.z + land.h - h),
		w,
		h,
	};
}
