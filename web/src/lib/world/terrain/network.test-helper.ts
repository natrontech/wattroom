import { landUse } from '../land';
import {
	camera,
	network,
	WORLD_SALT,
	type LatLon,
	type Road,
} from '../place/network.test-helper';
import type { Salt } from '../place/keyed';
import { lv95, originOf } from '../place/project';
import { around, createTerrain } from '../terrain-mesh';
import { makeGround } from './ground';
import type { Line } from './lines';

/**
 * #3226's synthetic network as the world's builds take it (#3075, #3076): its
 * roads as lines in the LV95 frame around the camera's chunk, and a world
 * built from them around that one camera, so level of detail never masks a
 * difference between two routes.
 */

const [ce, cn] = lv95(...camera());
export const origin = originOf(ce, cn);

export const local = (p: LatLon): [number, number] => {
	const [e, n] = lv95(p[0], p[1]);
	return [e - origin[0], origin[1] - n];
};

export const [camX, camZ] = local(camera());

/** A network road as a line, forwards or back, its heights lifted by `lift`. */
export function lineOf(r: Road, back = false, lift = 0): Line {
	const pts = (back ? [...r.points].reverse() : r.points).map(local);
	const hs = back ? [...r.heights].reverse() : r.heights;
	return {
		key: r.key,
		x: pts.map((p) => p[0]),
		z: pts.map((p) => p[1]),
		h: hs.map((v) => v + lift),
	};
}

export function build(lines: Line[], salt: Salt = WORLD_SALT) {
	const ground = makeGround(lines, { salt, origin });
	const cover = around(ground.lines, camX, camZ);
	const terrain = createTerrain(ground, cover.level, landUse(ground.noise));
	return { ground, cover, terrain };
}

export const [climb, valley, descent] = network().roads;

/** Each route's own order and direction: the loop, the climb as its own file, the climb ridden down. */
export const routeLines = {
	A: () => [lineOf(valley), lineOf(climb), lineOf(descent)],
	B: () => [lineOf(climb), lineOf(valley), lineOf(descent)],
	C: () => [lineOf(climb, true), lineOf(descent), lineOf(valley)],
};
