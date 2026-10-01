import { heightAt } from '$lib/road/at-metre';
import { climbsOf } from '$lib/road/climbs';
import { gainOf, gradeOf, roadName } from '$lib/road/profile';
import type { Road } from '$lib/road/road';
import type { Route } from '$lib/road/route';
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
		// A walked loop closes only as nearly as its whole-degree turns do: ridden to its end, never round.
		loop: false,
		road,
		shape: '',
		climbs: climbsOf(road),
		fixed: { spikes: 0, heldM: 0 },
	};
}
