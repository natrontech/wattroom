import { heightAt } from '$lib/road/at-metre';
import { roadStep, type Road } from '$lib/road/road';

/**
 * Metres climbed between two metres of a road (#3669): the rises along it
 * from one to the other, in the direction ridden, so a lap ridden back
 * counts the road's descents as its climbs. Falls count nothing. The ends
 * read the height between samples, so a second that moves less than a
 * sample adds its own rise and nothing of the sample around it.
 */
export function climbedM(road: Road, fromM: number, toM: number): number {
	const step = roadStep(road);
	const a = Math.max(0, Math.min(fromM, toM));
	const b = Math.min(road.length, Math.max(fromM, toM));
	const forward = toM >= fromM ? 1 : -1;
	let up = 0;
	let prev = heightAt(road, a);
	const rise = (h: number) => {
		const d = (h - prev) * forward;
		if (d > 0) up += d;
		prev = h;
	};
	for (let i = Math.floor(a / step) + 1; i <= Math.ceil(b / step) - 1; i++)
		rise(road.heights[i]);
	rise(heightAt(road, b));
	return up;
}
