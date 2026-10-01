import type { Salt } from './keyed';

/**
 * #3226's synthetic network: the repo never takes real routes, so the proof
 * runs on made-up strokes. A pass road with five hairpins (the map's own
 * stroke), a valley road to its foot and a descent back, all in Switzerland;
 * and one straight road across the UTM 32|33 line at 12°E for the seam.
 */

export type LatLon = readonly [number, number];
export type Road = {
	key: string;
	points: LatLon[];
	heights: number[];
	hairpins: number[];
};
export type Feature = { at: LatLon; name?: string };
export type Network = { roads: Road[]; features: Feature[] };
export type Route = { name: string; points: LatLon[] };

export const WORLD_SALT: Salt = [
	0x5eed0001, 0x0c0ffee0, 0x7a11c0de, 0x00c0ffee,
];
/** North of this the place has no height model, and the ground is keyed noise. */
export const DEM_EDGE_LAT = 46.609;
export const OWNER_SALT: Salt = [
	0x0dd0dd01, 0x12345678, 0x9abcdef0, 0x0badcafe,
];

const M = 111320;
/** Metres east and north of an origin, as a point: a fixture's convenience, never the world's. */
export const at = (o: LatLon, e: number, n: number): LatLon => [
	o[0] + n / M,
	o[1] + e / (M * Math.cos((o[0] * Math.PI) / 180)),
];

/** A polyline in metres, sampled every ~10 m: straight legs and half-turns of radius r. */
function trace(
	start: [number, number],
	moves: ([number, number] | ['turn', number])[],
): { xy: [number, number][]; apex: number[] } {
	const xy: [number, number][] = [start];
	const apex: number[] = [];
	let [x, y] = start;
	for (const m of moves) {
		if (m[0] === 'turn') {
			// A half-turn to the north: m[1] is +1 turning left from heading east, −1 from heading west.
			const r = 15;
			const cx = x;
			const cy = y + r;
			for (let k = 1; k <= 8; k++) {
				const a = -Math.PI / 2 + (m[1] * Math.PI * k) / 8;
				x = cx + r * Math.cos(a);
				y = cy + r * Math.sin(a);
				xy.push([x, y]);
				if (k === 4) apex.push(xy.length - 1);
			}
		} else {
			const [dx, dy] = m as [number, number];
			const steps = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy) / 10));
			const [x0, y0] = [x, y];
			for (let k = 1; k <= steps; k++)
				xy.push([x0 + (dx * k) / steps, y0 + (dy * k) / steps]);
			[x, y] = [x0 + dx, y0 + dy];
		}
	}
	return { xy, apex };
}

function road(
	key: string,
	o: LatLon,
	start: [number, number],
	moves: Parameters<typeof trace>[1],
	h0: number,
	h1: number,
): Road {
	const { xy, apex } = trace(start, moves);
	return {
		key,
		points: xy.map(([e, n]) => at(o, e, n)),
		heights: xy.map((_, i) => h0 + ((h1 - h0) * i) / (xy.length - 1)),
		hairpins: apex,
	};
}

const O: LatLon = [46.6, 8.4];

export function network(): Network {
	// prettier-ignore
	const climb = road('climb', O, [0, 0], [[0, 600], [300, 0], ['turn', 1], [-300, 0], ['turn', -1], [300, 0], ['turn', 1], [-300, 0], ['turn', -1], [300, 0], ['turn', 1], [-300, 0], [0, 600]], 1000, 1400);
	const topM: [number, number] = [0, 600 + 5 * 30 + 600];
	const valley = road(
		'valley',
		O,
		[-2000, -800],
		[
			[1000, 0],
			[1000, 800],
		],
		950,
		1000,
	);
	// prettier-ignore
	const descent = road('descent', O, topM, [[0, 500], [-2500, 0], [0, -2650], [500, 0]], 1400, 950);
	return {
		roads: [climb, valley, descent],
		features: [
			{ at: at(O, 0, topM[1]), name: 'Toyjoch' },
			{ at: at(O, 150, 780) }, // a chapel by the switchbacks, unnamed on the map
			{ at: at(O, -1500, -780) },
			{ at: at(O, -600, -500) },
		],
	};
}

/** A route over the network, in riding order: a road's points, forwards or back. */
const leg = (r: Road, back = false) =>
	back ? [...r.points].reverse() : r.points;

export function routes(): Record<'A' | 'B' | 'C' | 'Bn', Route> {
	const [climb, valley, descent] = network().roads;
	let seed = 42;
	const rnd = () =>
		((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
	return {
		A: {
			name: 'Toyjoch loop',
			points: [
				...leg(valley),
				...leg(climb).slice(1),
				...leg(descent).slice(1),
			],
		},
		B: { name: 'Toyjoch climb', points: leg(climb) },
		C: { name: 'Toyjoch descent', points: leg(climb, true) },
		// The climb re-recorded with a seeded GPS error of up to 3 m.
		Bn: {
			name: 'Toyjoch again',
			points: leg(climb).map((p) =>
				at(p, 3 * rnd() * Math.SQRT1_2, 3 * rnd() * Math.SQRT1_2),
			),
		},
	};
}

/** The camera both worlds are built around: halfway up the switchbacks, far from every route's ends. */
export const camera = (): LatLon => network().roads[0].points[120];

/** A straight road along 47.3°N across 12°E, where UTM zone 32 meets 33, and a route each way. */
export function seam(): {
	net: Network;
	east: Route;
	west: Route;
	camera: LatLon;
} {
	const points: LatLon[] = Array.from({ length: 301 }, (_, i) => [
		47.3,
		11.97 + (0.06 * i) / 300,
	]);
	const r: Road = {
		key: 'seam',
		points,
		heights: points.map(() => 800),
		hairpins: [],
	};
	return {
		net: { roads: [r], features: [] },
		east: { name: 'eastward', points },
		west: { name: 'westward', points: [...points].reverse() },
		camera: [47.3, 12.0],
	};
}
