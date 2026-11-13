/**
 * A designed world: a WattRoom road whose land is drawn on purpose. The
 * generator shapes the ground from the road alone, which makes rolling hills
 * anywhere and a lake nowhere. A designed road brings a scene with it: the
 * lake it runs along, the river it bridges, the peaks over its pass. Each is
 * laid out on the same made-up map as the road's corners, so the two fit to
 * the metre, and nothing of it is a place (no real track, no ODbL).
 *
 * The road is drawn on its designed line, not on the walk of its turns
 * (road-route.ts): a walk drifts tens of metres from the map it was read
 * off, and a bridge would land beside its river. Three-free and DOM-free:
 * the ground's worker builds the same scene from the same id.
 */
import { frameOf } from '#lib/road/line.ts';
import type { Road } from '#lib/road/road.ts';
import { toRoute, type Route } from '#lib/road/route.ts';
import { DESIGNS } from './designs';
import { smoothstep } from './rand';
import { designPoint, syntheticPoints, type Shape } from './synthetic';

/** A sheet of standing water: its level, metres above sea, and its outline in the world's frame. */
export type Water = { level: number; outline: [x: number, z: number][] };

export type Scene = {
	/** The designed ground at (x, z), from the generator's `h` there; `d` is metres to the nearest road. */
	shape(x: number, z: number, h: number, d: number): number;
	/** The level of the water standing over (x, z), or null on land. */
	waterAt(x: number, z: number): number | null;
	waters: Water[];
};

/** A point on the design's map, metres east and north, as a road's corners are. */
export type Spot = readonly [x: number, y: number];

/** One thing a scene is made of, on the design's map. */
export type Feature =
	| {
			kind: 'lake';
			/** Its shore, in order round it. */
			shore: readonly Spot[];
			level: number;
			/** Metres deep at the most: the bed falls away from the shore. */
			deep?: number;
			/** The land round it falls to the shore no gentler than `slope`, out to `reach` metres: none, the generator's land stands to the water's edge. */
			basin?: { slope: number; reach: number };
	  }
	| {
			kind: 'river';
			/** Its course: it runs level, a river in a gorge or across a plain. */
			course: readonly Spot[];
			width: number;
			level: number;
			/** Metres of flat bank either side before the gorge's walls rise, and how steeply: none, the river runs through open land. */
			gorge?: { bank: number; slope: number };
	  }
	| {
			kind: 'peak';
			at: Spot;
			/** Metres it stands over the generator's ground. */
			rise: number;
			/** Metres out at which it has fallen to 0.6 of that. */
			spread: number;
			/** Metres from a road within which it is not raised at all, and beyond which wholly: a road keeps its shelf. Default 120 and 700. */
			clear?: readonly [from: number, to: number];
	  };

export type Designed = {
	/** The home road's id (home-roads.ts). */
	id: string;
	/** The road's length to the centimetre, as toRoute builds it: how a road is known to be this one without building every design to ask. */
	lengthM: number;
	shape: Shape;
	features: readonly Feature[];
};

/** Rounds a line's corners off: each cut twice, a quarter in from either end (Chaikin). */
function rounded(
	pts: readonly (readonly [number, number])[],
	closed: boolean,
): [number, number][] {
	let line = pts.map((p) => [p[0], p[1]] as [number, number]);
	for (let pass = 0; pass < 3; pass++) {
		const next: [number, number][] = [];
		const n = line.length;
		if (!closed) next.push(line[0]);
		for (let i = 0; i < (closed ? n : n - 1); i++) {
			const a = line[i];
			const b = line[(i + 1) % n];
			next.push(
				[a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
				[a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75],
			);
		}
		if (!closed) next.push(line[n - 1]);
		line = next;
	}
	return line;
}

type Box = [x0: number, z0: number, x1: number, z1: number];
const boxOf = (pts: readonly [number, number][]): Box => {
	const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
	for (const [x, z] of pts) {
		b[0] = Math.min(b[0], x);
		b[1] = Math.min(b[1], z);
		b[2] = Math.max(b[2], x);
		b[3] = Math.max(b[3], z);
	}
	return b;
};
/** Metres from (x, z) to a box: 0 inside it. */
const offBox = (b: Box, x: number, z: number) =>
	Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - z, 0, z - b[3]));

/** Metres from (x, z) to the nearest point of a line's segments. */
function offLine(
	pts: readonly [number, number][],
	closed: boolean,
	x: number,
	z: number,
): number {
	let best = Infinity;
	const n = pts.length;
	for (let i = 0; i < (closed ? n : n - 1); i++) {
		const a = pts[i];
		const b = pts[(i + 1) % n];
		const sx = b[0] - a[0];
		const sz = b[1] - a[1];
		const t = Math.min(
			1,
			Math.max(
				0,
				((x - a[0]) * sx + (z - a[1]) * sz) / (sx * sx + sz * sz || 1),
			),
		);
		const d = (a[0] + sx * t - x) ** 2 + (a[1] + sz * t - z) ** 2;
		if (d < best) best = d;
	}
	return Math.sqrt(best);
}

/** Whether (x, z) lies inside a closed outline: a ray east crosses it an odd number of times. */
function inside(pts: readonly [number, number][], x: number, z: number) {
	let odd = false;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		const [xi, zi] = pts[i];
		const [xj, zj] = pts[j];
		if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
			odd = !odd;
	}
	return odd;
}

/** Metres past a feature its ground is still shaped: beyond, the generator's own. */
const REACH_M = 400;
/** The ground beside water stands this far over it at the least, and a bed this far under it at its edge. */
const FREEBOARD_M = 0.5;

type Part = {
	shape(x: number, z: number, h: number, d: number): number;
	waterAt?(x: number, z: number): number | null;
	water?: Water;
};

function part(f: Feature, world: (s: Spot) => [number, number]): Part {
	if (f.kind === 'peak') {
		const [px, pz] = world(f.at);
		const [from, to] = f.clear ?? [120, 700];
		// 0.6 of its rise at `spread` out: a bell, so its flanks are steepest half way up.
		const k = Math.log(1 / 0.6) / (f.spread * f.spread);
		const far = f.spread * 3.2;
		return {
			shape(x, z, h, d) {
				const r2 = (x - px) ** 2 + (z - pz) ** 2;
				if (r2 > far * far) return h;
				return h + f.rise * Math.exp(-k * r2) * smoothstep(from, to, d);
			},
		};
	}
	if (f.kind === 'lake') {
		const shore = rounded(f.shore.map(world), true);
		const box = boxOf(shore);
		const deep = f.deep ?? 25;
		return {
			shape(x, z, h, d) {
				const reach = Math.max(REACH_M, f.basin?.reach ?? 0);
				if (offBox(box, x, z) > reach) return h;
				const off = offLine(shore, true, x, z);
				if (inside(shore, x, z))
					return Math.min(h, f.level - Math.min(deep, FREEBOARD_M + 0.3 * off));
				if (off > reach) return h;
				// Its basin: the land falls to the shore, so the lake is seen from the road above it.
				let out = h;
				if (f.basin) {
					const cap = f.level + FREEBOARD_M + f.basin.slope * off;
					// Never under a road, nor within the 40 m its distance is read to: it keeps its shelf, and the land falls away beside it.
					const w =
						(1 - smoothstep(0.7 * f.basin.reach, f.basin.reach, off)) *
						smoothstep(40, 120, d);
					out += (Math.min(out, cap) - out) * w;
				}
				// The shore: land, rising a little from the water's edge, whatever the generator had there.
				const lift = f.level + Math.min(2, FREEBOARD_M + 0.04 * off);
				return (
					out +
					(Math.max(out, lift) - out) *
						(1 - smoothstep(0.5 * REACH_M, REACH_M, off))
				);
			},
			waterAt: (x, z) =>
				offBox(box, x, z) === 0 && inside(shore, x, z) ? f.level : null,
			water: { level: f.level, outline: shore },
		};
	}
	const course = rounded(f.course.map(world), false);
	const box = boxOf(course);
	const half = f.width / 2;
	// Its sheet: the course's left bank down it, and its right bank back.
	const left: [number, number][] = [];
	const right: [number, number][] = [];
	course.forEach((p, i) => {
		const a = course[Math.max(0, i - 1)];
		const b = course[Math.min(course.length - 1, i + 1)];
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		const nx = -(b[1] - a[1]) / len;
		const nz = (b[0] - a[0]) / len;
		left.push([p[0] + nx * half, p[1] + nz * half]);
		right.push([p[0] - nx * half, p[1] - nz * half]);
	});
	return {
		shape(x, z, h) {
			if (offBox(box, x, z) > REACH_M + half) return h;
			const off = offLine(course, false, x, z) - half;
			if (off <= 0)
				return Math.min(h, f.level - Math.min(4, FREEBOARD_M - 0.4 * off));
			let out = Math.max(h, f.level + Math.min(1.5, FREEBOARD_M + 0.06 * off));
			// A gorge: the land is cut down to the bank, and rises from it no steeper than its walls.
			if (f.gorge)
				out = Math.min(
					out,
					f.level + 1.5 + f.gorge.slope * Math.max(0, off - f.gorge.bank),
				);
			return out;
		},
		waterAt: (x, z) =>
			offBox(box, x, z) <= half && offLine(course, false, x, z) <= half
				? f.level
				: null,
		water: { level: f.level, outline: [...left, ...right.reverse()] },
	};
}

type Built = { line: Route; scene: Scene };
const built = new Map<string, Built>();

function build(d: Designed): Built {
	let b = built.get(d.id);
	if (b) return b;
	const points = syntheticPoints(d.shape);
	const frame = frameOf(points);
	// The design's map to the world's frame, exactly as the road's own points got there.
	const world = ([x, y]: Spot): [number, number] => {
		const p = designPoint(x, y);
		return [(p.lon - frame.lon0) * frame.kx, -(p.lat - frame.lat0) * frame.kz];
	};
	// Mountains first, water last: a peak's foot never stands in a lake, and a gorge is cut through whatever rose there.
	const parts = [...d.features]
		.sort((p, q) => Number(p.kind !== 'peak') - Number(q.kind !== 'peak'))
		.map((f) => part(f, world));
	const wet = parts.filter((p) => p.waterAt);
	b = {
		line: toRoute(points),
		scene: {
			shape(x, z, h, dist) {
				let out = h;
				for (const p of parts) out = p.shape(x, z, out, dist);
				return out;
			},
			waterAt(x, z) {
				for (const p of wet) {
					const level = p.waterAt!(x, z);
					if (level !== null) return level;
				}
				return null;
			},
			waters: parts.flatMap((p) => (p.water ? [p.water] : [])),
		},
	};
	built.set(d.id, b);
	return b;
}

/** The design a road was built from, if it is one of WattRoom's designed roads. */
export function designedFor(road: Road): Designed | undefined {
	const d = DESIGNS.find((k) => Math.abs(k.lengthM - road.length) < 0.005);
	if (!d) return undefined;
	// And its heights are the design's: a rider's own road as long to the centimetre is still their own.
	const own = build(d).line.road.heights;
	const mid = own.length >> 1;
	return own.length === road.heights.length &&
		own[0] === road.heights[0] &&
		own[mid] === road.heights[mid]
		? d
		: undefined;
}

/** A design's road on its own line: the samples the world draws it on. */
export const designedLine = (d: Designed): Route => build(d).line;

/** A design's scene, by its id: what the ground and its worker shape the land with. */
export function sceneOf(id: string | undefined): Scene | undefined {
	const d = id === undefined ? undefined : DESIGNS.find((k) => k.id === id);
	return d && build(d).scene;
}
