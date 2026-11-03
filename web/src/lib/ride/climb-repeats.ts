import { climbedM } from '$lib/ride/climbed';
import type { Road } from '$lib/road/road';

/** Everest (docs/spec/roads.md): 8,849 m, the 2020 survey — climb repeats' goal (#3193). */
export const EVEREST_M = 8849;

/**
 * The way up a road for climb repeats (#3193): the way that climbs more —
 * false from km 0, true ridden back from the far end. A loop, or a road
 * that climbs as much either way, has no way up: null.
 */
export function wayUp(road: Road, loop = false): boolean | null {
	if (loop) return null;
	const forward = climbedM(road, 0, road.length);
	const back = climbedM(road, road.length, 0);
	return forward === back ? null : back > forward;
}

/** How far up Everest the ride is: `1,234 of 8,849 m climbed · 3 ascents`. */
export function repeatsLine(climbed: number, ascents: number): string {
	const m = (v: number) => Math.round(v).toLocaleString('en-US');
	return `${m(climbed)} of ${m(EVEREST_M)} m climbed · ${ascents} ${ascents === 1 ? 'ascent' : 'ascents'}`;
}
