import { riddenOf, climbsOnRoad } from '$lib/ride/climb-view';
import { classedOf, type ClassedClimb } from '$lib/road/climbs';
import type { Road } from '$lib/road/road';
import type { SkylineView } from '$lib/road/skyline';
import { PARTS, walk } from '$lib/world/place/stroke';

/**
 * The MAP page's road (#3645, ADR-0063): the tier a rider on any road is
 * sent — heights, turns, climbs. The shape is walked from the turns alone, so
 * it carries no coordinate, no north and no place; the owner's own map stays
 * on the route's page.
 */
export interface MapView {
	road: Road;
	/** The dot: metres along the road as ridden. */
	m: number;
	climbs: ClassedClimb[];
}

export function mapView(view: SkylineView | null): MapView | null {
	if (!view) return null;
	const { road, m } = riddenOf(view);
	return { road, m, climbs: classedOf(climbsOnRoad(road)) };
}

const shapes = new WeakMap<Road, { x: number[]; z: number[] }>();

/**
 * The road's shape from its turns, once per road rather than once a second,
 * one vertex per stored sample: a stroke's finer parts are for the world.
 */
export function shapeOf(road: Road): { x: number[]; z: number[] } {
	let shape = shapes.get(road);
	if (!shape) {
		const { x, z } = walk(road);
		const at = (i: number) => i % PARTS === 0 || i === x.length - 1;
		shape = {
			x: Array.from(x).filter((_, i) => at(i)),
			z: Array.from(z).filter((_, i) => at(i)),
		};
		shapes.set(road, shape);
	}
	return shape;
}

/**
 * The shape turned, in 2° steps, to where it fills a w × h panel best: the
 * largest scale of the aspect-kept fit. A map has no north to keep (ADR-0063).
 */
export function bestTurn(
	x: number[],
	z: number[],
	w: number,
	h: number,
	pad: number,
): { x: number[]; z: number[] } {
	let best = { x, z };
	let top = 0;
	for (let deg = 0; deg < 180; deg += 2) {
		const [c, s] = [
			Math.cos((deg * Math.PI) / 180),
			Math.sin((deg * Math.PI) / 180),
		];
		const rx = x.map((xi, i) => xi * c - z[i] * s);
		const rz = x.map((xi, i) => xi * s + z[i] * c);
		const k = Math.min(
			(w - 2 * pad) / (Math.max(...rx) - Math.min(...rx) || 1),
			(h - 2 * pad) / (Math.max(...rz) - Math.min(...rz) || 1),
		);
		if (k > top) [top, best] = [k, { x: rx, z: rz }];
	}
	return best;
}
