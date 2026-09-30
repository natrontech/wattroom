// Where along the ridden route a spot lies: what the HUD's markers read a
// village's distance from. What stands beside the road asks the ground
// instead (terrain/ground.ts's `clearOf`, #3076, #3077), keyed by place.
import { type Route } from '$lib/road/route';
import { indexLines, type Hit } from './terrain/lines';

export type Nearest = (x: number, z: number, maxRing?: number) => Hit | null;

/** The route as one line, so a hit's `i` is the route's own sample. */
export function roadIndex(route: Route): { nearest: Nearest } {
	const index = indexLines([
		{ key: 'route', x: route.x, z: route.z, h: route.ele },
	]);
	return { nearest: (x, z, maxRing) => index.nearest(x, z, maxRing) };
}
