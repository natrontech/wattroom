import { cm, type Salt } from './keyed';
import { frameAt, project, type PlaceFrame } from './project';
import type { Thing } from './shared';
import {
	WORLD_SALT,
	type LatLon,
	type Network,
	type Route,
} from './network.test-helper';

/**
 * A toy world keyed by place (#3226, ADR-0081): trees per lattice cell, set
 * pieces per metre of each road, hairpins counted from the top, names from
 * the map or their 5 km tile, the ground from the height model and keyed
 * noise past its edge. The route decides nothing but its private ends. Each
 * mutant is one way a world has been keyed by the route instead, and each of
 * shared.ts's predicates must catch one. This file is what every part of the
 * toy shares: the salt, the frames, the route's shape and the map's roads.
 */
export type Mutant =
	| 'seed' // a salt from the route's name:length:gain
	| 'centroid' // frames centred on the route's centroid
	| 'bbox' // a lattice aligned to the route's bounding box
	| 'riding-time' // set pieces and the arch timed from the route's start
	| 'name-stream' // unnamed places named from one stream, in riding order
	| 'hairpins-from-start' // hairpins counted from where the route starts
	| 'tile-local' // outside LV95, the route start's frame for everything
	| 'region-world-cells' // a private region in world cells
	| 'region-world-secret'; // a private region keyed like the public world

export type Toy = {
	camera: LatLon;
	radius?: number;
	owner?: Salt;
	mutant?: Mutant;
};

const M = 111320;
const RAD = Math.PI / 180;
export const NAMES = [
	'Alp Crest',
	'Fuorcla',
	'Plan',
	'Chaunt',
	'Munt',
	'Pradè',
	'Sass',
	'Val',
];
export const TREES = ['spruce', 'larch', 'rock'];
export const nameOf = (f: PlaceFrame) =>
	f.system === 'LV95' ? 'LV95' : `UTM${f.zone}${f.south ? 'S' : 'N'}`;

/** A route's words as a salt: what a world keyed by its route name did. */
function saltFromWords(s: string): Salt {
	const w = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
	for (let i = 0; i < s.length; i++)
		w[i % 4] = Math.imul(w[i % 4] ^ s.charCodeAt(i), 0x01000193) >>> 0;
	return [w[0], w[1], w[2], w[3]];
}

export type Ctx = ReturnType<typeof context>;

export function context(net: Network, route: Route, o: Toy) {
	const mut = o.mutant;
	const R = o.radius ?? 250;
	const [lat0, lon0] = o.camera;
	const k0 = M * Math.cos(lat0 * RAD);
	const xy = (p: LatLon): [number, number] => [
		(p[1] - lon0) * k0,
		(p[0] - lat0) * M,
	];
	const ll = (x: number, y: number): LatLon => [lat0 + y / M, lon0 + x / k0];
	const routeXY = route.points.map(xy);
	const along: number[] = [0];
	for (let i = 1; i < routeXY.length; i++)
		along.push(
			along[i - 1] +
				Math.hypot(
					routeXY[i][0] - routeXY[i - 1][0],
					routeXY[i][1] - routeXY[i - 1][1],
				),
		);
	const length = along.at(-1)!;
	const gain = route.points.length; // ponytail: a stand-in for elevation gain — any route-only number keys as badly
	const salt =
		mut === 'seed'
			? saltFromWords(`${route.name}:${Math.round(length)}:${gain}`)
			: WORLD_SALT;
	const startFrame = frameAt(route.points[0][0], route.points[0][1]);
	const centroid = (f: PlaceFrame) => {
		const ps = route.points.map((p) => project(f, p[0], p[1]));
		return [
			ps.reduce((s, p) => s + p[0], 0) / ps.length,
			ps.reduce((s, p) => s + p[1], 0) / ps.length,
		];
	};
	const bboxMin = (f: PlaceFrame) => {
		const ps = route.points.map((p) => project(f, p[0], p[1]));
		return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1]))];
	};
	/** Where a point is keyed: its frame's name, and coordinates the lattice is aligned to. */
	const keyAt = (
		p: LatLon,
	): { frame: string; e: number; n: number; oe: number; on: number } => {
		const own = frameAt(p[0], p[1]);
		const f = mut === 'tile-local' && own.system !== 'LV95' ? startFrame : own;
		const [e, n] = project(f, p[0], p[1]);
		if (mut === 'centroid') {
			const [ce, cn] = centroid(f);
			return { frame: 'centroid', e: e - ce, n: n - cn, oe: 0, on: 0 };
		}
		const [oe, on] = mut === 'bbox' ? bboxMin(f) : [0, 0];
		return { frame: nameOf(f), e, n, oe, on };
	};
	const floorCm = (m: number) => cm(m) / 100;
	// Private ends: 400 m at each end of the route, 100 m either side — no map data read there.
	const nearest = (x: number, y: number) => {
		let best = { d: Infinity, a: 0 };
		for (let i = 1; i < routeXY.length; i++) {
			const [ax, ay] = routeXY[i - 1];
			const [bx, by] = routeXY[i];
			const L = Math.hypot(bx - ax, by - ay) || 1;
			const t = Math.min(
				Math.max(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (L * L), 0),
				1,
			);
			const d = Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
			if (d < best.d) best = { d, a: along[i - 1] + t * L };
		}
		return best;
	};
	const inRegion = (x: number, y: number) => {
		if (!o.owner || mut === 'region-world-secret') return false;
		const q = nearest(x, y);
		return q.d <= 100 && (q.a <= 400 || q.a >= length - 400);
	};
	// The map's roads, for earthworks and for keeping trees off them.
	const roadXY = net.roads.map((r) => r.points.map(xy));
	const onRoad = (x: number, y: number, within: number) => {
		for (const [ri, pts] of roadXY.entries())
			for (const [i, [px, py]] of pts.entries())
				if ((px - x) * (px - x) + (py - y) * (py - y) <= within * within)
					return net.roads[ri].heights[i];
		return null;
	};
	const place = (kind: string, p: LatLon, text?: string): Thing => {
		const k = keyAt(p);
		return { kind, frame: k.frame, e: floorCm(k.e), n: floorCm(k.n), text };
	};
	const seen = (p: LatLon) => {
		const [x, y] = xy(p);
		return x * x + y * y <= R * R;
	};
	const routeIndexOf = (p: LatLon) => {
		const [x, y] = xy(p);
		let best = 0;
		for (let i = 1; i < routeXY.length; i++)
			if (
				Math.hypot(routeXY[i][0] - x, routeXY[i][1] - y) <
				Math.hypot(routeXY[best][0] - x, routeXY[best][1] - y)
			)
				best = i;
		return best;
	};

	return {
		mut,
		R,
		salt,
		xy,
		ll,
		routeXY,
		along,
		length,
		keyAt,
		floorCm,
		inRegion,
		onRoad,
		place,
		seen,
		routeIndexOf,
	};
}
