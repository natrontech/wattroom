import { heightAt } from '#lib/road/at-metre.ts';
import { climbsOf } from '#lib/road/climbs.ts';
import { gainOf, gradeOf, roadName } from '#lib/road/profile.ts';
import type { Road } from '#lib/road/road.ts';
import type { Route } from '#lib/road/route.ts';
import { walk } from './place/stroke';
import { crossingsOf, levelCrossings, meetingsOf } from './crossings';
import { shareRoad } from './shared-road';

/** Metres between the route's samples, as a route file's are (route.ts). */
const STEP_M = 10;

/**
 * The road a ride carries, as the world builds from it (#3663): its heights
 * and turns, walked in the road's own frame and centred on it. A rider on a
 * crewmate's road holds only this, never the owner's coordinates (ADR-0063),
 * so the owner's world and the crew's are built alike. Metre 0 is the
 * road's first sample, the one the ride's own metres count from. A stretch
 * it rides twice is drawn once (shared-road.ts); `share` false draws every
 * pass where it was recorded.
 */
export function routeOfRoad(road: Road, share = true): Route {
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
	// A road that ends where it began ends at the height it began at. One whose end stands high over its start, a hairpin's upper leg beside its lower, has two ends.
	const home = Math.abs(ele[n - 1] - ele[0]) <= HOME_RISE_M;
	const flat = home && closeWalk(x, z, road.length) ? closeHeights(ele) : ele;
	// Centred, as a route file's frame is: the horizon stands round the middle.
	const cx = x.reduce((s, v) => s + v, 0) / n;
	const cz = z.reduce((s, v) => s + v, 0) / n;
	for (let k = 0; k < n; k++) {
		x[k] -= cx;
		z[k] -= cz;
	}
	const gain = gainOf(ele);
	// A road ridden twice is drawn once (#4531): its metres and grades stay as recorded.
	const drawn = share ? shareRoad(x, z, flat, step) : null;
	// And one that crosses itself meets there at one height (crossings.ts).
	const line = {
		x: drawn?.x ?? x,
		z: drawn?.z ?? z,
		ele: drawn?.ele ?? flat,
		step,
		length: road.length,
		shared: drawn?.shared,
	};
	const level = levelCrossings(line);
	const bare = meetingsOf(crossingsOf(line), drawn?.joins);
	return {
		name: roadName(road.length, gain),
		step,
		length: road.length,
		x: drawn?.x ?? x,
		z: drawn?.z ?? z,
		ele: level ?? drawn?.ele ?? flat,
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
		...(drawn && { shared: drawn.shared }),
		...(bare.length > 0 && { bare }),
	};
}

/**
 * And no higher over it than this, metres: a barometer drifts as much over a
 * long ride; a road that ends higher climbed there, and ends beside its
 * start, not on it.
 */
export const HOME_RISE_M = 30;

/** A walk that ends this near its start, as a share of its length, is a loop's. */
export const CLOSES_WITHIN = 0.01;

/**
 * Closes a walked loop: the walk ends only as near its start as its
 * whole-degree turns let it, 25 m off on the Pass loop, and the world drew
 * that seam as a road stopping short beside its own start (a voice channel's
 * free ride stands there until the rider pedals). The miss is spread along
 * the road by its metres, under a millimetre a metre, so the end meets the
 * start and the ride's world goes round it. A road whose end lies further
 * off is a road with two ends, and keeps them. Whether it closed.
 */
export function closeWalk(
	x: Float64Array,
	z: Float64Array,
	length: number,
): boolean {
	const n = x.length - 1;
	const gx = x[n] - x[0];
	const gz = z[n] - z[0];
	if (n < 1 || Math.hypot(gx, gz) > length * CLOSES_WITHIN) return false;
	for (let k = 1; k <= n; k++) {
		x[k] -= (gx * k) / n;
		z[k] -= (gz * k) / n;
	}
	return true;
}

/**
 * A closed road's heights, closed too: a ride's barometer drifts, and a loop
 * recorded 10 m higher home than out drew its last metre as a ramp into the
 * bank over its first, the start arch buried in it. The ground has one
 * height at a spot, so the miss is spread along the road by its metres, half
 * up at the start and half down at the end: 10 m round 25 km moves no grade
 * by more than 0.04 %. Only where the world draws it, as a shared road is
 * (shared-road.ts): the ride's metres and grades stay as recorded.
 */
export function closeHeights(ele: Float64Array): Float64Array {
	const n = ele.length - 1;
	const miss = ele[n] - ele[0];
	if (n < 1 || Math.abs(miss) < 0.01) return ele;
	return ele.map((h, k) => h + miss * (0.5 - k / n));
}
