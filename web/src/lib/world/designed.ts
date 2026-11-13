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
import {
	designPoint,
	syntheticPoints,
	type Corner,
	type Shape,
} from './synthetic';

/** A sheet of water: its level, metres above sea, and its outline in the world's frame. */
export type Water = {
	level: number;
	outline: [x: number, z: number][];
	/**
	 * Running water, a stream down a hillside: the outline is its left bank
	 * down it and its right bank back, and each cross-section has its own
	 * level and its share of white water, 1 where it falls.
	 */
	run?: { levels: number[]; foam: number[] };
};

/** Ground a scene lays out by hand: a raised bog, a dry valley floor. */
export type Cover = 'moor' | 'dry';
/** Where a scene's snow lies from and its trees stand to, metres above sea: the generator's own where not given. */
export type Climate = { snowline?: number; treeline?: number };

/** A designed road's own names, in the order the road meets them: no two of WattRoom's roads share a pass or a village. Past the last, the generator's. */
export type PlaceNames = {
	/** Each pass where it stands, in the world's frame: a summit within 500 m of one takes its name. */
	passes: { name: string; x: number; z: number }[];
	/** Villages, by the 5 km tile each stands in: sixteen names, so no two tiles within 20 km share one. */
	villages: readonly string[];
};

export type Scene = {
	/** The designed ground at (x, z), from the generator's `h` there; `d` is metres to the nearest road. */
	shape(x: number, z: number, h: number, d: number): number;
	/** The level of the water over (x, z), or null on land. */
	waterAt(x: number, z: number): number | null;
	/** What the scene lays over (x, z), or null where the land's own cover grows. */
	coverAt(x: number, z: number): Cover | null;
	climate: Climate;
	names: PlaceNames;
	/** Its galleries, each from one spot on the road to another, in the world's frame: the road roofed over against the mountain, open to the valley between pillars. */
	galleries: [from: [number, number], to: [number, number]][];
	waters: Water[];
};

/**
 * A scene before its streams are laid. A stream runs where the land lets
 * it: its levels are read off the ground it runs down, lakes and peaks and
 * all, so it is laid once that ground is known (terrain/ground.ts).
 */
export type Layout = Scene & {
	/** The scene with its streams, laid on `ground`: the land as `shape` has it. `key` names that ground, the place's salt. */
	laid(key: string, ground: (x: number, z: number) => number): Scene;
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
			kind: 'stream';
			/** Its course from its source down: it follows the land, falls where the land falls, and ends at the first standing water it meets. */
			course: readonly Spot[];
			/** Metres wide: 7 where not given. */
			width?: number;
	  }
	| {
			kind: 'land';
			cover: Cover;
			at: Spot;
			/** Metres out to its edge, which wanders a fifth of that. */
			radius: number;
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
	climate?: Climate;
	names?: {
		passes: readonly { name: string; at: Spot }[];
		villages: readonly string[];
	};
	/** The map's other loops, by id: their roads are drawn where they leave this one. */
	others?: readonly string[];
	/** Its roundabouts: each a ring road round a node, which every road through the node rides and joins. */
	rings?: readonly {
		at: Spot;
		r: number;
		ele: number;
		/** The bearings of its arms, radians anticlockwise from east. */
		arms: number[];
		/** What stands on its island. */
		statue: 'bicycle' | 'cow';
	}[];
	/** Roads no loop rides: a lane off to a farm, a road across the plateau, each from its first corner to its last. Drawn as the other loops' roads are. */
	spurs?: readonly (readonly Corner[])[];
	/** Galleries: each from one spot on the road to another. */
	galleries?: readonly (readonly [Spot, Spot])[];
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
type Solid = Exclude<Feature, { kind: 'stream' | 'land' }>;
type World = (s: Spot) => [number, number];

/** Metres between a stream's cross-sections. */
const STREAM_STEP_M = 10;
/** A stream's bed lies this far under the land it runs down, and its water this far over its bed. */
const STREAM_CUT_M = 1.4;
const STREAM_DEEP_M = 0.6;
/** Metres past its banks the ground is levelled to its bed: a terrain vertex stands every 10 m, and one at the least must stand in it. */
const SWALE_M = 9;
/** Past the swale its gully's sides rise no steeper than this. */
const GULLY_SLOPE = 0.7;
/** The fall along a stream at which its water starts to whiten, and at which it is a waterfall. */
const FOAM = [0.2, 0.6] as const;

/** A line walked again at every `step` metres. */
function stepped(pts: readonly [number, number][], step: number) {
	const out: [number, number][] = [pts[0]];
	let carry = 0;
	for (let i = 1; i < pts.length; i++) {
		const [ax, az] = pts[i - 1];
		const len = Math.hypot(pts[i][0] - ax, pts[i][1] - az);
		let at = step - carry;
		for (; at <= len; at += step)
			out.push([
				ax + ((pts[i][0] - ax) * at) / len,
				az + ((pts[i][1] - az) * at) / len,
			]);
		carry = len - (at - step);
	}
	return out;
}

/** A stream, laid on the ground it runs down. */
function stream(
	f: Extract<Feature, { kind: 'stream' }>,
	world: World,
	ground: (x: number, z: number) => number,
	standing: (x: number, z: number) => number | null,
): Part | null {
	const all = stepped(rounded(f.course.map(world), false), STREAM_STEP_M);
	// To the first standing water: a stream ends in its lake.
	const end = all.findIndex((p, i) => i > 0 && standing(p[0], p[1]) !== null);
	const course = end < 0 ? all : all.slice(0, end + 1);
	if (course.length < 3) return null;
	const n = course.length;
	// Water runs down: where the land rises again the stream has cut through it.
	const levels: number[] = [];
	let level = Infinity;
	for (const [x, z] of course)
		levels.push((level = Math.min(level, ground(x, z) - STREAM_CUT_M)));
	// And never lower than the water it runs into: there it would have ponded.
	const into = end < 0 ? null : standing(course[n - 1][0], course[n - 1][1]);
	if (into !== null)
		for (let i = 0; i < n; i++) levels[i] = Math.max(levels[i], into);
	const foam = levels.map((_, i) => {
		const a = Math.max(0, i - 1);
		const b = Math.min(n - 1, i + 1);
		return smoothstep(
			FOAM[0],
			FOAM[1],
			(levels[a] - levels[b]) / ((b - a) * STREAM_STEP_M),
		);
	});
	const half = (f.width ?? 7) / 2;
	// Its stretches, each in its own box: a spot far from a stretch never walks it.
	const SPAN = 12;
	const boxes: Box[] = [];
	for (let i = 0; i < n - 1; i += SPAN)
		boxes.push(boxOf(course.slice(i, Math.min(n, i + SPAN + 1))));
	/** The stream's nearest point to (x, z) within `reach`: metres off its centre, and its level and fall there. */
	const near = (x: number, z: number, reach: number) => {
		let best = reach * reach;
		let at = -1;
		let share = 0;
		for (let b = 0; b < boxes.length; b++) {
			if (offBox(boxes[b], x, z) > reach) continue;
			const to = Math.min(n - 1, (b + 1) * SPAN);
			for (let i = b * SPAN; i < to; i++) {
				const [ax, az] = course[i];
				const sx = course[i + 1][0] - ax;
				const sz = course[i + 1][1] - az;
				const t = Math.min(
					1,
					Math.max(0, ((x - ax) * sx + (z - az) * sz) / (sx * sx + sz * sz)),
				);
				const d = (ax + sx * t - x) ** 2 + (az + sz * t - z) ** 2;
				if (d < best) {
					best = d;
					at = i;
					share = t;
				}
			}
		}
		if (at < 0) return null;
		return {
			off: Math.sqrt(best),
			level: levels[at] + (levels[at + 1] - levels[at]) * share,
			fall: (levels[at] - levels[at + 1]) / STREAM_STEP_M,
		};
	};
	const left: [number, number][] = [];
	const right: [number, number][] = [];
	course.forEach((p, i) => {
		const a = course[Math.max(0, i - 1)];
		const b = course[Math.min(n - 1, i + 1)];
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		const nx = -(b[1] - a[1]) / len;
		const nz = (b[0] - a[0]) / len;
		left.push([p[0] + nx * half, p[1] + nz * half]);
		right.push([p[0] - nx * half, p[1] - nz * half]);
	});
	return {
		shape(x, z, h) {
			const s = near(x, z, half + SWALE_M + 40);
			if (!s) return h;
			// Its bed, deeper where it falls: the ground between two vertices is a straight line, and the water must lie over it.
			const bed = s.level - STREAM_DEEP_M - 2 * s.fall;
			const out = s.off - half;
			if (out <= 3) return bed;
			if (out <= SWALE_M) return Math.min(h, bed);
			return Math.min(h, bed + GULLY_SLOPE * (out - SWALE_M));
		},
		waterAt(x, z) {
			const s = near(x, z, half);
			return s && s.level;
		},
		water: {
			level: levels[n - 1],
			outline: [...left, ...right.reverse()],
			run: { levels, foam },
		},
	};
}

function part(f: Solid, world: World): Part {
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

type Built = { line: Route; scene: Layout };
const built = new Map<string, Built>();

function sceneFrom(
	parts: readonly Part[],
	covers: Scene['coverAt'],
	climate: Climate,
	names: PlaceNames,
	galleries: Scene['galleries'],
): Scene {
	const wet = parts.filter((p) => p.waterAt);
	return {
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
		coverAt: covers,
		climate,
		names,
		galleries,
		waters: parts.flatMap((p) => (p.water ? [p.water] : [])),
	};
}

function build(d: Designed): Built {
	let b = built.get(d.id);
	if (b) return b;
	const points = syntheticPoints(d.shape);
	const frame = frameOf(points);
	// The world's frame is the map's own, east and south of its origin, whichever loop is ridden: every loop on a map draws the same land in the same place, and each other's roads where they lie. The road's own points come centred on themselves (toRoute), so they are moved back onto the map.
	const centred = (x: number, y: number): [number, number] => {
		const p = designPoint(x, y);
		return [(p.lon - frame.lon0) * frame.kx, -(p.lat - frame.lat0) * frame.kz];
	};
	const [ox, oz] = centred(0, 0);
	const kx = (centred(1000, 0)[0] - ox) / 1000;
	const kz = (centred(0, 1000)[1] - oz) / 1000;
	const world = ([x, y]: Spot): [number, number] => [x, -y];
	const drawn = toRoute(points);
	const line: Route = {
		...drawn,
		x: drawn.x.map((x) => (x - ox) / kx),
		z: drawn.z.map((z) => -(z - oz) / kz),
	};
	// Mountains first, water last: a peak's foot never stands in a lake, and a gorge is cut through whatever rose there.
	const solid = d.features.filter(
		(f): f is Solid => f.kind !== 'stream' && f.kind !== 'land',
	);
	const parts = [...solid]
		.sort((p, q) => Number(p.kind !== 'peak') - Number(q.kind !== 'peak'))
		.map((f) => part(f, world));
	const lands = d.features.flatMap((f) => {
		if (f.kind !== 'land') return [];
		const [x, z] = world(f.at);
		return [
			{ x, z, r: f.radius, cover: f.cover, turn: (x * 7 + z * 13) % 6.28 },
		];
	});
	const covers: Scene['coverAt'] = (x, z) => {
		for (const l of lands) {
			const dx = x - l.x;
			const dz = z - l.z;
			const r2 = dx * dx + dz * dz;
			if (r2 > l.r * l.r * 1.6) continue;
			// Its edge wanders in and out by a fifth, three bays and seven coves round it.
			const a = Math.atan2(dz, dx) + l.turn;
			const edge = l.r * (1 + 0.14 * Math.sin(3 * a) + 0.07 * Math.sin(7 * a));
			if (r2 < edge * edge) return l.cover;
		}
		return null;
	};
	const climate = d.climate ?? {};
	const names: PlaceNames = {
		passes: (d.names?.passes ?? []).map((p) => {
			const [x, z] = world(p.at);
			return { name: p.name, x, z };
		}),
		villages: d.names?.villages ?? [],
	};
	const galleries = (d.galleries ?? []).map(
		([a, b]): Scene['galleries'][number] => [world(a), world(b)],
	);
	const dry = sceneFrom(parts, covers, climate, names, galleries);
	const streams = d.features.filter((f) => f.kind === 'stream');
	const laid = new Map<string, Scene>();
	b = {
		line,
		scene: {
			...dry,
			laid(key, ground) {
				if (streams.length === 0) return dry;
				let scene = laid.get(key);
				if (scene) return scene;
				const run = streams.flatMap(
					(f) => stream(f, world, ground, dry.waterAt) ?? [],
				);
				// The streams are cut into the ground they were laid on, and the standing water they run into is asked first.
				const whole = sceneFrom(
					[...parts, ...run],
					covers,
					climate,
					names,
					galleries,
				);
				scene = {
					...whole,
					shape(x, z, h, dist) {
						let out = dry.shape(x, z, h, dist);
						for (const p of run) out = p.shape(x, z, out, dist);
						return out;
					},
				};
				// A ride's place and the few a page may draw beside it: never every salt there is.
				if (laid.size >= 4) laid.clear();
				laid.set(key, scene);
				return scene;
			},
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

/** Metres between a spur's samples, as between a road's. */
const SPUR_STEP_M = 10;
const SPUR_LEAD_M = 25;

/** A spur as a road's line: its corners rounded off, walked every 10 m, in the map's frame. Never ridden, so it has no road to send. */
function spur(corners: readonly Corner[], like: Route): Route {
	let line = corners.map((c) => [c.x, -c.y, c.ele]);
	// A spur starts on a road's corner as it was drawn, and the road, rounded and wound, runs a few metres off that: the spur starts SPUR_LEAD_M short of it, on its own line, so it crosses the road wherever it lies and is cut at its edge (side-roads.ts drops the stub left on the far side).
	const [first, next] = line;
	const run = Math.hypot(next[0] - first[0], next[1] - first[1]) || 1;
	line.unshift([
		first[0] - ((next[0] - first[0]) / run) * SPUR_LEAD_M,
		first[1] - ((next[1] - first[1]) / run) * SPUR_LEAD_M,
		first[2],
	]);
	for (let pass = 0; pass < 3; pass++) {
		const next = [line[0]];
		for (let i = 0; i + 1 < line.length; i++) {
			const [a, b] = [line[i], line[i + 1]];
			next.push(
				a.map((v, k) => v * 0.75 + b[k] * 0.25),
				a.map((v, k) => v * 0.25 + b[k] * 0.75),
			);
		}
		next.push(line[line.length - 1]);
		line = next;
	}
	const out: number[][] = [line[0]];
	let carry = 0;
	for (let i = 1; i < line.length; i++) {
		const [a, b] = [line[i - 1], line[i]];
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
		let at = SPUR_STEP_M - carry;
		for (; at <= len; at += SPUR_STEP_M)
			out.push(a.map((v, k) => v + ((b[k] - v) * at) / len));
		carry = len - (at - SPUR_STEP_M);
	}
	const ele = Float64Array.from(out, (p) => p[2]);
	return {
		...like,
		name: 'spur',
		step: SPUR_STEP_M,
		length: (out.length - 1) * SPUR_STEP_M,
		x: Float64Array.from(out, (p) => p[0]),
		z: Float64Array.from(out, (p) => p[1]),
		ele,
		grade: ele.map((h, i) =>
			i === 0 ? 0 : ((h - ele[i - 1]) / SPUR_STEP_M) * 100,
		),
		gain: 0,
		loop: false,
		climbs: [],
	};
}

/** Metres a roundabout's arm is drawn as a road of its own, out from the ring's centre line. */
export const ARM_M = 30;
/** How much wider an arm is at the ring than a road, and the metres over which it narrows to one. */
const ARM_FLARE = 1.1;
const ARM_FLARE_M = 22;

/**
 * A design's roundabouts' arms, each a straight road from the ring out
 * ARM_M: one road for the way in and the way out, whichever way a line
 * sweeps onto the ring there. The lines through a roundabout turn onto it
 * within a few metres, and a ribbon drawn on such a line bulges and folds;
 * so near the ring the roads ridden and not ridden are hidden, and these
 * stand for them.
 */
export function armsOf(id: string | undefined): Route[] {
	const d = DESIGNS.find((k) => k.id === id);
	if (!d?.rings) return [];
	const like = build(d).line;
	// Every loop of the map: an arm takes its heights from whichever road runs along it.
	const lines = DESIGNS.filter((k) => k.rings).map((k) => build(k).line);
	const n = ARM_M / 2;
	return d.rings.flatMap((ring) =>
		ring.arms.map((a) => {
			const x = Float64Array.from(
				{ length: n + 1 },
				(_, k) => ring.at[0] + Math.cos(a) * (ring.r + 2 * k),
			);
			const z = Float64Array.from(
				{ length: n + 1 },
				(_, k) => -(ring.at[1] + Math.sin(a) * (ring.r + 2 * k)),
			);
			const ele = Float64Array.from(x, (px, k) => {
				let best = 8;
				let h = ring.ele;
				for (const l of lines)
					for (let i = 0; i < l.x.length; i++) {
						if (Math.abs(l.x[i] - px) > best) continue;
						const off = Math.hypot(l.x[i] - px, l.z[i] - z[k]);
						if (off < best) {
							best = off;
							h = l.ele[i];
						}
					}
				// At the ring it is the ring's height, whatever the road there has.
				return ring.ele + (h - ring.ele) * smoothstep(0, 12, 2 * k);
			});
			return {
				...like,
				name: 'arm',
				step: 2,
				length: ARM_M,
				x,
				z,
				ele,
				grade: new Float64Array(n + 1),
				gain: 0,
				loop: false,
				level: true,
				// Flared to the ring, as a roundabout's entries and exits are: a rider turning onto the ring or off it stays on asphalt.
				widen: (m: number) =>
					1 + ARM_FLARE * (1 - smoothstep(2, ARM_FLARE_M, m)),
				climbs: [],
				shared: undefined,
				meets: undefined,
			};
		}),
	);
}

/** A design's roundabouts as the stage dresses them, in the world's frame: the centre, the ring's radius, the way each arm leaves (a unit vector), and its statue. */
export const roundaboutsOf = (id: string | undefined) =>
	(DESIGNS.find((k) => k.id === id)?.rings ?? []).map((ring) => ({
		x: ring.at[0],
		z: -ring.at[1],
		r: ring.r,
		ele: ring.ele,
		arms: ring.arms.map((a): [number, number] => [Math.cos(a), -Math.sin(a)]),
		statue: ring.statue,
	}));

/** A design's roundabouts, each as a road that goes round: a closed line, a point every 3 m or so. Never ridden as a road of its own. */
export function ringsOf(id: string | undefined): Route[] {
	const d = DESIGNS.find((k) => k.id === id);
	if (!d?.rings) return [];
	const like = build(d).line;
	return d.rings.map((ring) => {
		const n = Math.round((2 * Math.PI * ring.r) / 3);
		const step = 2 * ring.r * Math.sin(Math.PI / n);
		const x = new Float64Array(n + 1);
		const z = new Float64Array(n + 1);
		for (let k = 0; k <= n; k++) {
			const a = ((k % n) / n) * 2 * Math.PI;
			x[k] = ring.at[0] + Math.cos(a) * ring.r;
			z[k] = -(ring.at[1] + Math.sin(a) * ring.r);
		}
		return {
			...like,
			name: 'ring',
			step,
			length: n * step,
			x,
			z,
			ele: new Float64Array(n + 1).fill(ring.ele),
			grade: new Float64Array(n + 1),
			gain: 0,
			loop: true,
			level: true,
			climbs: [],
			shared: undefined,
			meets: undefined,
		};
	});
}

/** The map's other roads as a design's road meets them, each on its own line: its other loops, and its spurs. */
export function othersOf(id: string | undefined): Route[] {
	const d = DESIGNS.find((k) => k.id === id);
	if (!d) return [];
	const own = build(d).line;
	return [
		...(d.others ?? []).flatMap((o) => {
			const other = DESIGNS.find((k) => k.id === o);
			return other ? [build(other).line] : [];
		}),
		...(d.spurs ?? []).map((corners) => spur(corners, own)),
	];
}

/** A design's scene, by its id: what the ground and its worker shape the land with, once the ground has laid its streams. */
export function sceneOf(id: string | undefined): Layout | undefined {
	const d = id === undefined ? undefined : DESIGNS.find((k) => k.id === id);
	return d && build(d).scene;
}
