// What stands beside the ridden road asks two things of it: where its
// nearest point is, and how much room a thing needs there. The ground itself
// is terrain/ground.ts's (#3075); these stay on the route until the props
// and set pieces are keyed by place too (#3076, #3077).
import { type Route } from '$lib/road/route';
import { curvature } from '$lib/road/along';
import { indexLines, type Hit } from './terrain/lines';

export type Nearest = (x: number, z: number, maxRing?: number) => Hit | null;

/** The route as one line, so a hit's `i` is the route's own sample. */
export function roadIndex(route: Route): { nearest: Nearest } {
	const index = indexLines([
		{ key: 'route', x: route.x, z: route.z, h: route.ele },
	]);
	return { nearest: (x, z, maxRing) => index.nearest(x, z, maxRing) };
}

export type Field = ReturnType<typeof makeField>;

export function makeField(route: Route) {
	// How much room a thing needs from the road at sample i on `side`: more on
	// the inside of a bend, where the camera's sightline cuts the corner.
	function clearance(i: number, side: number, base: number): number {
		const k = curvature(route, Math.min(route.x.length - 1, Math.max(0, i)));
		if (Math.sign(k) !== side || Math.abs(k) < 1 / 400) return base;
		const r = 1 / Math.abs(k);
		const half = 18; // half the chord from the chase camera (~8 m behind) to its gaze (~18 m ahead)
		const sag = r <= half ? r : r - Math.sqrt(r * r - half * half);
		return base + sag + 4;
	}
	return { clearance };
}

// Is (x, z) at least `base` metres (more inside a bend) from the road?
export function clearOf(
	field: Field,
	nearest: Nearest,
	x: number,
	z: number,
	base: number,
): boolean {
	const hit = nearest(x, z, 2);
	if (!hit) return true; // farther than two hash rings (~80 m), past any clearance: nothing to block
	return hit.d >= field.clearance(hit.i, hit.side, base);
}
