import { heightAt } from '#lib/road/at-metre.ts';
import { climbsOf } from '#lib/road/climbs.ts';
import { gainOf, gradeOf, roadName } from '#lib/road/profile.ts';
import type { Road } from '#lib/road/road.ts';
import type { Route } from '#lib/road/route.ts';
import { walk } from './place/stroke';

/** Metres between the route's samples, as a route file's are (route.ts). */
const STEP_M = 10;

/**
 * The road a ride carries, as the world builds from it (#3663): its heights
 * and turns, walked in the road's own frame and centred on it. A rider on a
 * crewmate's road holds only this, never the owner's coordinates (ADR-0063),
 * so the owner's world and the crew's are built alike. Metre 0 is the
 * road's first sample, the one the ride's own metres count from.
 */
export function routeOfRoad(road: Road): Route {
	const { x: wx, z: wz, part } = walk(road);
	const n = Math.max(2, Math.round(road.length / STEP_M) + 1);
	const step = road.length / (n - 1);
	const x = new Float64Array(n);
	const z = new Float64Array(n);
	const ele = new Float64Array(n);
	const last = wx.length - 1;
	for (let k = 0; k < n; k++) {
		const at = Math.min((k * step) / part, last);
		const i = Math.min(Math.floor(at), last - 1);
		const f = at - i;
		x[k] = wx[i] + (wx[i + 1] - wx[i]) * f;
		z[k] = wz[i] + (wz[i + 1] - wz[i]) * f;
		ele[k] = heightAt(road, k * step);
	}
	closeWalk(x, z, road.length);
	// Centred, as a route file's frame is: the horizon stands round the middle.
	const cx = x.reduce((s, v) => s + v, 0) / n;
	const cz = z.reduce((s, v) => s + v, 0) / n;
	for (let k = 0; k < n; k++) {
		x[k] -= cx;
		z[k] -= cz;
	}
	const gain = gainOf(ele);
	return {
		name: roadName(road.length, gain),
		step,
		length: road.length,
		x,
		z,
		ele,
		grade: gradeOf(ele, step),
		gain,
		minEle: Math.min(...ele),
		maxEle: Math.max(...ele),
		// Whether it is ridden round is the ride's to say (compose.ts): a loop's walk is closed above.
		loop: false,
		road,
		shape: '',
		climbs: climbsOf(road),
		fixed: { spikes: 0, heldM: 0 },
	};
}

/** A walk that ends this near its start, as a share of its length, is a loop's. */
export const CLOSES_WITHIN = 0.01;

/**
 * Closes a walked loop: the walk ends only as near its start as its
 * whole-degree turns let it, 25 m off on the Pass loop, and the world drew
 * that seam as a road stopping short beside its own start (a voice channel's
 * free ride stands there until the rider pedals). The miss is spread along
 * the road by its metres, under a millimetre a metre, so the end meets the
 * start and the ride's world goes round it. A road whose end lies further
 * off is a road with two ends, and keeps them.
 */
export function closeWalk(x: Float64Array, z: Float64Array, length: number) {
	const n = x.length - 1;
	const gx = x[n] - x[0];
	const gz = z[n] - z[0];
	if (n < 1 || Math.hypot(gx, gz) > length * CLOSES_WITHIN) return;
	for (let k = 1; k <= n; k++) {
		x[k] -= (gx * k) / n;
		z[k] -= (gz * k) / n;
	}
}
