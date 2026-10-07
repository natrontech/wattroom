import { roadStep, type Road } from '$lib/road/road';

/**
 * Metres climbed between two metres of a road (#3669): the rises between
 * its samples from one to the other, in the direction ridden, so a lap
 * ridden back counts the road's descents as its climbs. Falls count nothing.
 */
export function climbedM(road: Road, fromM: number, toM: number): number {
	const step = roadStep(road);
	const last = road.heights.length - 1;
	const lo = Math.max(0, Math.floor(Math.min(fromM, toM) / step));
	const hi = Math.min(last, Math.ceil(Math.max(fromM, toM) / step));
	const forward = toM >= fromM ? 1 : -1;
	let up = 0;
	for (let i = lo; i < hi; i++) {
		const rise = (road.heights[i + 1] - road.heights[i]) * forward;
		if (rise > 0) up += rise;
	}
	return up;
}
