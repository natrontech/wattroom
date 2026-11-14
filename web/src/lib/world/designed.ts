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
import { FORMATION } from './terrain/road-profile';
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
	/** How its bed falls from the shore: metres down a metre out, to `deep` at the most, past the freeboard (FREEBOARD_M). */
	bed?: {
		slope: number;
		deep: number;
		/** Metres down a metre out at (x, z) where it is not `slope`: a lake's shallows fall gentler. */
		fall?: (x: number, z: number) => number;
	};
	/** A river's course, the way it flows: its line down the middle. */
	course?: [x: number, z: number][];
	/** A lake's islands, each an outline: land, a hole in its sheet. */
	islands?: [x: number, z: number][][];
};

/**
 * Ground a scene lays out by hand: a raised bog or a lake's reeds, a dry
 * valley floor or a beach, an alp's open pasture above the forest, a field of
 * scree under a cliff, a valley floor's fields, and a wood where the
 * generator would mow.
 */
export type Cover =
	'moor' | 'dry' | 'alp' | 'scree' | 'fields' | 'wood' | 'gravel';
/** Where a scene's snow lies from and its trees stand to, metres above sea: the generator's own where not given. */
export type Climate = { snowline?: number; treeline?: number };

/** A designed road's own names, in the order the road meets them: no two of WattRoom's roads share a pass or a village. Past the last, the generator's. */
export type PlaceNames = {
	/** Each pass where it stands, in the world's frame: a summit within 500 m of one takes its name. */
	passes: { name: string; x: number; z: number }[];
	/** Villages, by the 5 km tile each stands in: sixteen names, so no two tiles within 20 km share one. */
	villages: readonly string[];
	/** Hamlets and villages that stand where the map draws them, on the road nearest each, by their own names. */
	hamlets?: { name: string; x: number; z: number }[];
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
	/** Its tunnels, each from one portal on the road to the other, in the world's frame: the road through the hill, the ground left closed over it. */
	tunnels: [from: [number, number], to: [number, number]][];
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
			/** Its islands, each an outline: land standing out of it, a little knoll on each. */
			islands?: readonly (readonly Spot[])[];
			/** Where its bed shelves gently, a beach's or a delta's shallows: within `radius` of `at` the bed falls a tenth as steeply. */
			shallows?: readonly { at: Spot; radius: number }[];
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
			/** Metres its bed lies under the land it runs down: STREAM_CUT_M where not given. A valley's river runs in banks of its own, a road over it on a bridge. */
			cut?: number;
			/** Its water's level at each spot of its course, falling: drawn, not read off the land. A valley's river, whose land is its own floor. */
			levels?: readonly number[];
			/** Its floor: within `bank` metres of its banks the land lies flat, `cut` less 1.5 m over its water, and rises from there no steeper than `slope`. A wide valley's fields. */
			plain?: { bank: number; slope: number };
			/** Metres of gravel either side of its water, the bars a mountain river lays down: none where not given. */
			gravel?: number;
	  }
	| {
			kind: 'land';
			cover: Cover;
			at: Spot;
			/** Metres out to its edge, which wanders a fifth of that. */
			radius: number;
	  }
	| {
			kind: 'land';
			cover: Cover;
			/** Its outline, in order round it: fields and woods have edges a farmer drew. */
			area: readonly Spot[];
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
		hamlets?: readonly { name: string; at: Spot }[];
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
	/** Roads no loop rides: a road across the plateau, each from its first corner to its last, drawn as the other loops' roads are; and gravel lanes (Lane). */
	spurs?: readonly (readonly Corner[] | Lane)[];
	/** Galleries: each from one spot on the road to another. */
	galleries?: readonly (readonly [Spot, Spot])[];
	/** Tunnels: each from one portal on a loop's road to the other. */
	tunnels?: readonly (readonly [Spot, Spot])[];
};

/**
 * A gravel lane: a farm track or a forest road, three metres of gravel with
 * no paint, no sign and no rail, that leaves a loop's road or crosses it at
 * a plain junction. Drawn through `course`, its heights the land's own
 * (world.ts drapes it): an end within LANE_SNAP_M of a loop's road starts on
 * that road.
 */
export type Lane = { kind: 'gravel'; course: readonly Spot[] };
export const isLane = (s: readonly Corner[] | Lane): s is Lane =>
	!Array.isArray(s);

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
	if (pts.length < INSIDE_CELLS_FROM) return crossesOdd(pts, x, z);
	let cells = insideCells.get(pts);
	if (!cells) insideCells.set(pts, (cells = cellsOf(pts)));
	const key =
		Math.floor(x / INSIDE_CELL) * 100_003 + Math.floor(z / INSIDE_CELL);
	// A cell the outline never touches is all inside or all out: asked once.
	if (cells.edged.has(key)) return crossesOdd(pts, x, z);
	let known = cells.known.get(key);
	if (known === undefined)
		cells.known.set(key, (known = crossesOdd(pts, x, z)));
	return known;
}

/** Metres a side of the cells an outline's inside is known by; an outline of fewer points than INSIDE_CELLS_FROM is walked whole each time. */
const INSIDE_CELL = 25;
const INSIDE_CELLS_FROM = 24;
/** Per outline: the cells its edges touch, and what is known of the rest. A world's ground asks a lake's or a cover's shore some millions of times. */
const insideCells = new WeakMap<
	readonly [number, number][],
	{ edged: Set<number>; known: Map<number, boolean> }
>();
function cellsOf(pts: readonly [number, number][]) {
	const edged = new Set<number>();
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % pts.length];
		for (
			let ci = Math.floor(Math.min(a[0], b[0]) / INSIDE_CELL);
			ci <= Math.floor(Math.max(a[0], b[0]) / INSIDE_CELL);
			ci++
		)
			for (
				let cj = Math.floor(Math.min(a[1], b[1]) / INSIDE_CELL);
				cj <= Math.floor(Math.max(a[1], b[1]) / INSIDE_CELL);
				cj++
			)
				edged.add(ci * 100_003 + cj);
	}
	return { edged, known: new Map<number, boolean>() };
}

function crossesOdd(pts: readonly [number, number][], x: number, z: number) {
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
export const FREEBOARD_M = 0.5;
/** Metres a lake's bed falls a metre out from its shore, and a river's from its bank, to its deepest. */
const LAKE_BED = 0.3;
const RIVER_BED = 0.4;
const RIVER_DEEP_M = 4;
/** Metres an island's knoll stands over the water at the most. */
const ISLE_M = 14;

type Part = {
	shape(x: number, z: number, h: number, d: number): number;
	waterAt?(x: number, z: number): number | null;
	/** The ground it lays by hand at (x, z), over the design's own covers: a river's gravel bars. */
	coverAt?(x: number, z: number): Cover | null;
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

/** Metres past a river's plain its floor is let go of: the land beyond is the generator's again. */
const PLAIN_EASE_M = 400;

/** A course's drawn levels, one per spot of it, at each of `n` points spread along it by length. */
function levelsAlong(
	course: readonly Spot[],
	at: readonly number[],
	n: number,
): number[] {
	const arc = [0];
	for (let i = 1; i < course.length; i++)
		arc.push(
			arc[i - 1] +
				Math.hypot(
					course[i][0] - course[i - 1][0],
					course[i][1] - course[i - 1][1],
				),
		);
	const total = arc[arc.length - 1];
	return Array.from({ length: n }, (_, k) => {
		const s = (k / Math.max(1, n - 1)) * total;
		let i = 0;
		while (i < arc.length - 2 && arc[i + 1] < s) i++;
		const t = (s - arc[i]) / (arc[i + 1] - arc[i] || 1);
		return at[i] + (at[i + 1] - at[i]) * Math.min(1, Math.max(0, t));
	});
}

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
	const drawn = f.levels && levelsAlong(f.course, f.levels, n);
	course.forEach(([x, z], i) =>
		levels.push(
			(level = Math.min(
				level,
				drawn ? drawn[i] : ground(x, z) - (f.cut ?? STREAM_CUT_M),
			)),
		),
	);
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
	const plain = f.plain;
	/** The most `near` is asked to reach: the ground's shape, out to its swale's or its plain's edge. */
	const REACH = half + (plain ? plain.bank + PLAIN_EASE_M : SWALE_M + 40);
	// Its stretches, each in its own box: a spot far from a stretch never walks it.
	const SPAN = 12;
	const boxes: Box[] = [];
	for (let i = 0; i < n - 1; i += SPAN)
		boxes.push(boxOf(course.slice(i, Math.min(n, i + SPAN + 1))));
	// And the boxes each cell of the land lies within REACH of, in order: a spot walks only those, not every stretch of every stream on the map (a world's build spent half its ground there).
	const CELL = 64;
	const cellKey = (i: number, j: number) => i * 100_003 + j;
	const byCell = new Map<number, number[]>();
	boxes.forEach((b, k) => {
		for (
			let i = Math.floor((b[0] - REACH) / CELL);
			i <= Math.floor((b[2] + REACH) / CELL);
			i++
		)
			for (
				let j = Math.floor((b[1] - REACH) / CELL);
				j <= Math.floor((b[3] + REACH) / CELL);
				j++
			) {
				const list = byCell.get(cellKey(i, j));
				if (list) list.push(k);
				else byCell.set(cellKey(i, j), [k]);
			}
	});
	const every = boxes.map((_, k) => k);
	const none: number[] = [];
	/** The stream's nearest point to (x, z) within `reach`: metres off its centre, and its level and fall there. */
	const near = (x: number, z: number, reach: number) => {
		let best = reach * reach;
		let at = -1;
		let share = 0;
		const listed =
			reach <= REACH
				? (byCell.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ??
					none)
				: every;
		for (const b of listed) {
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
	const floor = (f.cut ?? STREAM_CUT_M) - 1.5;
	return {
		shape(x, z, h) {
			const s = near(x, z, REACH);
			if (!s) return h;
			// Its bed, deeper where it falls: the ground between two vertices is a straight line, and the water must lie over it.
			const bed = s.level - STREAM_DEEP_M - 2 * s.fall;
			const out = s.off - half;
			if (out <= 3) return bed;
			if (out <= SWALE_M) return Math.min(h, bed);
			let land = Math.min(h, bed + GULLY_SLOPE * (out - SWALE_M));
			// Its floor, flat to the valley's sides and rising up them; let go of over the last PLAIN_EASE_M.
			if (plain) {
				const cap = Math.max(
					bed + GULLY_SLOPE * (out - SWALE_M),
					s.level + floor + plain.slope * Math.max(0, out - plain.bank),
				);
				const w = 1 - smoothstep(plain.bank, plain.bank + PLAIN_EASE_M, out);
				land = Math.min(land, h + (Math.min(h, cap) - h) * w);
			}
			return land;
		},
		waterAt(x, z) {
			const s = near(x, z, half);
			return s && s.level;
		},
		...(f.gravel && {
			coverAt: (x: number, z: number) =>
				near(x, z, half + f.gravel!) ? ('gravel' as const) : null,
		}),
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
		const isles = (f.islands ?? []).map((i) => {
			const outline = rounded(i.map(world), true);
			return { outline, box: boxOf(outline) };
		});
		const shelves = (f.shallows ?? []).map((s) => {
			const [x, z] = world(s.at);
			return { x, z, r: s.radius };
		});
		/** Whether (x, z) stands on one of its islands. */
		const onIsle = (x: number, z: number) =>
			isles.some((i) => offBox(i.box, x, z) === 0 && inside(i.outline, x, z));
		/** How steeply its bed falls from the shore at (x, z): a tenth as steep in its shallows. */
		const fall = (x: number, z: number) => {
			let gentle = 0;
			for (const s of shelves)
				gentle = Math.max(
					gentle,
					1 - smoothstep(0.6 * s.r, s.r, Math.hypot(x - s.x, z - s.z)),
				);
			return LAKE_BED * (1 - 0.9 * gentle);
		};
		return {
			shape(x, z, h, d) {
				const reach = Math.max(REACH_M, f.basin?.reach ?? 0);
				if (offBox(box, x, z) > reach) return h;
				let off = offLine(shore, true, x, z);
				if (inside(shore, x, z)) {
					// An island: a knoll out of the water, rising from its shore.
					for (const i of isles) {
						if (offBox(i.box, x, z) > reach) continue;
						const to = offLine(i.outline, true, x, z);
						if (inside(i.outline, x, z))
							return Math.max(
								f.level + FREEBOARD_M + 0.04 * to,
								f.level + Math.min(ISLE_M, 0.25 * to),
							);
						off = Math.min(off, to);
					}
					return Math.min(
						h,
						f.level - Math.min(deep, FREEBOARD_M + fall(x, z) * off),
					);
				}
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
				// The shore: land, rising a little from the water's edge, whatever the generator had there; a beach by its shallows, lower and longer.
				const lift =
					f.level +
					Math.min(2, FREEBOARD_M + (fall(x, z) / LAKE_BED) * 0.04 * off);
				return (
					out +
					(Math.max(out, lift) - out) *
						(1 - smoothstep(0.5 * REACH_M, REACH_M, off))
				);
			},
			waterAt: (x, z) =>
				offBox(box, x, z) === 0 && inside(shore, x, z) && !onIsle(x, z)
					? f.level
					: null,
			water: {
				level: f.level,
				outline: shore,
				bed: { slope: LAKE_BED, deep, ...(shelves.length > 0 && { fall }) },
				...(isles.length > 0 && { islands: isles.map((i) => i.outline) }),
			},
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
				return Math.min(
					h,
					f.level - Math.min(RIVER_DEEP_M, FREEBOARD_M - RIVER_BED * off),
				);
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
		water: {
			level: f.level,
			outline: [...left, ...right.reverse()],
			bed: { slope: RIVER_BED, deep: RIVER_DEEP_M },
			course,
		},
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
	tunnels: Scene['tunnels'],
): Scene {
	const wet = parts.filter((p) => p.waterAt);
	const laid = parts.filter((p) => p.coverAt);
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
		coverAt:
			laid.length === 0
				? covers
				: (x, z) => {
						for (const p of laid) {
							const c = p.coverAt!(x, z);
							if (c !== null) return c;
						}
						return covers(x, z);
					},
		climate,
		names,
		galleries,
		tunnels,
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
	type Laid =
		| { cover: Cover; outline: [number, number][]; box: Box }
		| { cover: Cover; x: number; z: number; r: number; turn: number };
	const lands = d.features.flatMap((f): Laid[] => {
		if (f.kind !== 'land') return [];
		if ('area' in f) {
			const outline = f.area.map(world);
			return [{ cover: f.cover, outline, box: boxOf(outline) }];
		}
		const [x, z] = world(f.at);
		return [
			{ x, z, r: f.radius, cover: f.cover, turn: (x * 7 + z * 13) % 6.28 },
		];
	});
	const covers: Scene['coverAt'] = (x, z) => {
		for (const l of lands) {
			if ('outline' in l) {
				if (offBox(l.box, x, z) === 0 && inside(l.outline, x, z))
					return l.cover;
				continue;
			}
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
		hamlets: (d.names?.hamlets ?? []).map((h) => {
			const [x, z] = world(h.at);
			return { name: h.name, x, z };
		}),
	};
	const galleries = (d.galleries ?? []).map(
		([a, b]): Scene['galleries'][number] => [world(a), world(b)],
	);
	const tunnels = (d.tunnels ?? []).map(([a, b]): Scene['tunnels'][number] => [
		world(a),
		world(b),
	]);
	const dry = sceneFrom(parts, covers, climate, names, galleries, tunnels);
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
					tunnels,
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
	// The first, a quarter and the middle: a loop turned round starts where it ends, and with an odd count its middle is its middle either way.
	const at = [0, own.length >> 2, own.length >> 1];
	return own.length === road.heights.length &&
		at.every((i) => own[i] === road.heights[i])
		? d
		: undefined;
}

/** A design's road on its own line: the samples the world draws it on. */
export const designedLine = (d: Designed): Route => build(d).line;

/** Metres between a spur's samples, as between a road's. */
const SPUR_STEP_M = 10;
const SPUR_LEAD_M = 25;

/** A lane's end within this of a loop's road starts on that road. */
const LANE_SNAP_M = 60;

/** A spur as a road's line: its corners rounded off, walked every 10 m, in the map's frame. Never ridden, so it has no road to send. */
function spur(
	corners: readonly Corner[],
	like: Route,
	/** Whether each end starts on a road, and is led SPUR_LEAD_M on through it: a spur's first end always. */
	lead: readonly [boolean, boolean] = [true, false],
): Route {
	let line = corners.map((c) => [c.x, -c.y, c.ele]);
	// A spur starts on a road's corner as it was drawn, and the road, rounded and wound, runs a few metres off that: the spur starts SPUR_LEAD_M short of it, on its own line, so it crosses the road wherever it lies and is cut at its edge (side-roads.ts drops the stub left on the far side).
	const led = (first: number[], next: number[]) => {
		const run = Math.hypot(next[0] - first[0], next[1] - first[1]) || 1;
		return [
			first[0] - ((next[0] - first[0]) / run) * SPUR_LEAD_M,
			first[1] - ((next[1] - first[1]) / run) * SPUR_LEAD_M,
			first[2],
		];
	};
	if (lead[0]) line.unshift(led(line[0], line[1]));
	if (lead[1]) line.push(led(line[line.length - 1], line[line.length - 2]));
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
/** How many times a road's width an arm is drawn `m` metres out from the ring's centre line: what its asphalt, its shoulders and everything kept off it go by. */
export const armWiden = (m: number) =>
	1 + ARM_FLARE * (1 - smoothstep(2, ARM_FLARE_M, m));

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
				widen: armWiden,
				climbs: [],
				shared: undefined,
				meets: undefined,
			};
		}),
	);
}

/** A roundabout's signs stand this far out from its ring's centre line, and this far past the arm's shoulder there, on the right of each arm as it comes in. */
const RING_SIGN = { out: 15, past: 0.8 };

/** Where the signs before an arm leaving the ring at (x, z) on the unit vector (dx, dz) stand: off its flared shoulder, on the right coming in, which is the arm's left as it leaves. */
export function ringSignAt(
	ring: { x: number; z: number; r: number },
	[dx, dz]: readonly [number, number],
) {
	const out = ring.r + RING_SIGN.out;
	const side = FORMATION * armWiden(RING_SIGN.out) + RING_SIGN.past;
	return { x: ring.x + dx * out + dz * side, z: ring.z + dz * out - dx * side };
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

const lanes = new WeakMap<
	Lane,
	{ corners: Corner[]; lead: [boolean, boolean] }
>();
/** A lane's course as a spur's corners: each end within LANE_SNAP_M of a loop's road or a spur's moved onto it, and whether it was. */
function laneCorners(
	lane: Lane,
	d: Designed,
): {
	corners: Corner[];
	lead: [boolean, boolean];
} {
	const kept = lanes.get(lane);
	if (kept) return kept;
	const own = build(d).line;
	// Its own loop and the loops it shares its land with, in the map's order: the Valley has no others.
	const loops = [
		...DESIGNS.filter((k) => k === d || d.others?.includes(k.id)).map(
			(k) => build(k).line,
		),
		...(d.spurs ?? []).flatMap((s) => (isLane(s) ? [] : [spur(s, own)])),
	];
	const snap = ([x, y]: Spot): [Spot, boolean] => {
		let best = LANE_SNAP_M;
		let at: Spot = [x, y];
		for (const l of loops)
			for (let i = 0; i < l.x.length; i += 2) {
				if (Math.abs(l.x[i] - x) > best) continue;
				const d = Math.hypot(l.x[i] - x, -l.z[i] - y);
				if (d < best) {
					best = d;
					at = [l.x[i], -l.z[i]];
				}
			}
		return [at, best < LANE_SNAP_M];
	};
	const [first, a] = snap(lane.course[0]);
	const [last, b] = snap(lane.course[lane.course.length - 1]);
	const spots = [first, ...lane.course.slice(1, -1), last];
	const out = {
		corners: spots.map(([x, y]) => ({ x, y, ele: 0, r: 0 })),
		lead: [a, b] as [boolean, boolean],
	};
	lanes.set(lane, out);
	return out;
}

/** The map's other roads as a design's road meets them, each on its own line: its other loops, and its spurs. A gravel lane's heights are the land's, laid by world.ts. */
export function othersOf(id: string | undefined): Route[] {
	const d = DESIGNS.find((k) => k.id === id);
	if (!d) return [];
	const own = build(d).line;
	return [
		...(d.others ?? []).flatMap((o) => {
			const other = DESIGNS.find((k) => k.id === o);
			return other ? [build(other).line] : [];
		}),
		...(d.spurs ?? []).map((s) => {
			if (!isLane(s)) return spur(s, own);
			const { corners, lead } = laneCorners(s, d);
			return { ...spur(corners, own, lead), gravel: true };
		}),
	];
}

/** A design's scene, by its id: what the ground and its worker shape the land with, once the ground has laid its streams. */
export function sceneOf(id: string | undefined): Layout | undefined {
	const d = id === undefined ? undefined : DESIGNS.find((k) => k.id === id);
	return d && build(d).scene;
}
