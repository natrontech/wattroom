import { MaxRoadSpeedMps } from '$lib/protocol';
import type { Road } from '$lib/road/road';
import type { Frame } from '$lib/road/skyline';

/** docs/SPEC.md: a road is stored every 20 m. */
const STEP_M = 20;

/**
 * A saved road ride's own profile (#3639): its heights over the metres it
 * rode, laps and all — what its page draws as a static Skyline. From the
 * ride's own samples, never its route, so a route since deleted leaves the
 * page whole. Null for a ride off a road, or one too short to draw.
 *
 * A zero is left out of the saved samples, so on a road ride a missing
 * metre or height is 0. A sample further on than a rider goes in a second
 * is a new lap from the road's start, not a ride.
 */
export function rideProfile(
	samples: readonly { m?: number; alt?: number }[],
): Road | null {
	if (!samples.some((s) => s.m !== undefined || s.alt !== undefined))
		return null;
	const ridden = [0];
	for (let i = 1; i < samples.length; i++) {
		const step = Math.abs((samples[i].m ?? 0) - (samples[i - 1].m ?? 0));
		ridden.push(ridden[i - 1] + (step <= MaxRoadSpeedMps ? step : 0));
	}
	const length = ridden.at(-1)!;
	if (length < 2 * STEP_M) return null;
	const n = Math.floor(length / STEP_M);
	const heights: number[] = [];
	let j = 0;
	for (let k = 0; k <= n; k++) {
		const at = (k * length) / n;
		while (j < ridden.length - 2 && ridden[j + 1] < at) j++;
		const span = ridden[j + 1] - ridden[j];
		const f = span > 0 ? (at - ridden[j]) / span : 0;
		const a = samples[j].alt ?? 0;
		const b = samples[j + 1].alt ?? 0;
		heights.push(a + (b - a) * Math.min(Math.max(f, 0), 1));
	}
	return { length, heights, turns: Array<number>(n).fill(0) };
}

/** The whole road in one slot of `width` × `height`, for skyline.ts's tiles. */
export function wholeRoadFrame(
	road: Road,
	width: number,
	height: number,
): Frame {
	const lo = Math.min(...road.heights);
	const hi = Math.max(...road.heights);
	return {
		scale: width / road.length,
		fromM: 0,
		lo,
		span: Math.max(hi - lo, 1),
		width,
		height,
	};
}
