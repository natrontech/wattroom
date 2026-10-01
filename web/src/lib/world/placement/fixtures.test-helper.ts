import { parseRoute } from '$lib/road/parse';
import { toRoute } from '$lib/road/route';
import { ROAD_W } from '../geometry';
import { syntheticGpx } from '../synthetic';
import type { P2 } from './geom';
import type { Ground, Road } from './types';

/**
 * #3219's fixtures, none of them from a rider: the synthetic loop, a steep
 * stack of switchbacks, and a corridor with a side road, one mark of every
 * real-place kind (#3134) and a privacy zone. Each is roads plus the ground
 * as drawn, which is all the gates read.
 */
export type Fixture = { roads: Road[]; ground: Ground };

/** A rectangle w × d centred on (x, z), turned by `heading` radians. */
export function rect(
	x: number,
	z: number,
	w: number,
	d: number,
	heading = 0,
): P2[] {
	const c = Math.cos(heading);
	const s = Math.sin(heading);
	return [
		[-w / 2, -d / 2],
		[w / 2, -d / 2],
		[w / 2, d / 2],
		[-w / 2, d / 2],
	].map(([u, v]) => [x + u * c - v * s, z + u * s + v * c] as P2);
}

/** Nearest point of a polyline: its index, along-fraction position and signed offset (left positive). */
function nearestOn(points: readonly P2[], x: number, z: number) {
	let best = { k: 0, t: 0, dist: Infinity, side: 0 };
	for (let k = 0; k < points.length - 1; k++) {
		const [ax, az] = points[k];
		const [bx, bz] = points[k + 1];
		const dx = bx - ax;
		const dz = bz - az;
		const t = Math.min(
			Math.max(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0),
			1,
		);
		const ex = x - ax - t * dx;
		const ez = z - az - t * dz;
		const dist = Math.hypot(ex, ez);
		if (dist < best.dist)
			best = { k, t, dist, side: Math.sign(dx * ez - dz * ex) || 1 };
	}
	return best;
}

/** The synthetic pass loop, its road as the generator draws it and the ground level across it. */
export function syntheticLoop(): Fixture {
	const route = toRoute(parseRoute(syntheticGpx()).points);
	const points: P2[] = Array.from(route.x, (x, i) => [x, route.z[i]] as P2);
	const ground: Ground = (x, z) => {
		const n = nearestOn(points, x, z);
		return route.ele[n.k] + (route.ele[n.k + 1] - route.ele[n.k]) * n.t;
	};
	return { roads: [{ points, halfWidth: ROAD_W / 2 }], ground };
}

export const STEEP = {
	grade: 0.12,
	radius: 8,
	bankDeg: 4,
	leg: 120,
	legs: 5,
} as const;

/**
 * Stacked switchbacks: legs of 120 m climbing at 12 %, joined by hairpins of
 * 8 m radius banked 4° to the outside, one above the other.
 */
export function steep(): Fixture & { hairpins: P2[] } {
	const { grade, radius, bankDeg, leg, legs } = STEEP;
	const pts: P2[] = [];
	const hairpins: P2[] = [];
	const bendOf: number[] = []; // the hairpin a point is on, or −1 on a leg
	let x = 0;
	let z = 0;
	for (let l = 0; l < legs; l++) {
		const dir = l % 2 === 0 ? 1 : -1;
		for (let s = 0; s < leg; s += 2) {
			pts.push([x + dir * s, z]);
			bendOf.push(-1);
		}
		x += dir * leg;
		// A half turn about (x, z − R), bulging the way the leg ran, ending one leg up the stack.
		const [cx, cz] = [x, z - radius];
		hairpins.push([cx, cz]);
		for (let a = 0; a <= 16; a++) {
			const phi = (Math.PI * a) / 16;
			pts.push([
				cx + dir * radius * Math.sin(phi),
				cz + radius * Math.cos(phi),
			]);
			bendOf.push(hairpins.length - 1);
		}
		z -= 2 * radius;
	}
	const along: number[] = [0];
	for (let i = 1; i < pts.length; i++)
		along.push(
			along[i - 1] +
				Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
		);
	const bank = Math.tan((bankDeg * Math.PI) / 180);
	const hw = ROAD_W / 2;
	const ground: Ground = (qx, qz) => {
		const n = nearestOn(pts, qx, qz);
		const h = (along[n.k] + (along[n.k + 1] - along[n.k]) * n.t) * grade;
		const b = bendOf[n.k];
		if (b < 0) return h;
		// On a hairpin the road is banked: the outside edge up, the inside down, the verges level with them.
		const [cx, cz] = hairpins[b];
		const out = Math.hypot(qx - cx, qz - cz) - radius;
		return h + bank * Math.max(-hw, Math.min(hw, out));
	};
	return {
		roads: [{ points: pts, halfWidth: hw, sag: 0.5 }],
		ground,
		hairpins,
	};
}

/** Every kind of real place #3134 draws, and the guideposts and benches the place lab found. */
export const MARKS = [
	'village-sign-main',
	'village-sign-secondary',
	'pass',
	'fountain',
	'church',
	'bridge',
	'cattle-grid',
	'guidepost',
	'bench',
] as const;

/**
 * A straight 2 km main road east, a side road leaving it north at 1 km, a
 * mark of every kind along it, and a privacy zone around its start.
 */
export function corridor(): Fixture & {
	marks: { kind: (typeof MARKS)[number]; at: P2 }[];
	zone: { at: P2; radius: number };
} {
	const main: P2[] = Array.from({ length: 201 }, (_, i) => [i * 10, 0] as P2);
	const side: P2[] = Array.from(
		{ length: 41 },
		(_, i) => [1000, -i * 10] as P2,
	);
	const marks = MARKS.map((kind, i) => ({
		kind,
		at: [150 + i * 200, 14] as P2,
	}));
	return {
		roads: [
			{ points: main, halfWidth: ROAD_W / 2 },
			{ points: side, halfWidth: 2.5 },
		],
		ground: () => 500,
		marks,
		zone: { at: [0, 0], radius: 200 },
	};
}
