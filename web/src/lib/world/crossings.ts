/**
 * Where a route crosses its own line: a figure of eight, a loop that cuts
 * back over its way out, a road over another on a bridge. Each crossing is
 * the two metres along the route that meet in plan, how far apart their
 * heights are and the angle between the two passes. Three-free, a grid over
 * the segments: linear in the route's length.
 *
 * A stretch ridden twice alongside itself is not a crossing but a shared
 * road (shared-road.ts); a hairpin's two legs never touch. Only two passes
 * that are far apart along the route and meet at a point count.
 */

/** Metres along the route two samples lie apart at least to be two passes, not one bend. */
const APART_M = 100;

export type Crossing = {
	/** Metres along the route where the earlier pass is crossed. */
	a: number;
	/** Metres along the route where the later pass crosses it. */
	b: number;
	/** East and south of the crossing point, in the route's frame. */
	x: number;
	z: number;
	/** The later pass's height over the earlier one's, metres: negative, it runs under. */
	rise: number;
	/** Degrees between the two passes, 0–90: 90 is a square crossing. */
	angle: number;
};

/** Metres from the other pass's centre line beyond which a pass's paint is its own: past the other's formation. */
export const CLEAR_M = 12;
/** A shallow crossing reads the other pass for longer, to this at most either side. */
const REACH_MAX_M = 80;

/** A crossroads, both passes alike; a pass joining an earlier one, which gives way to it; and the earlier one it joins. */
export const CROSSES = 0;
export const JOINS = 1;
export const JOINED = -1;

/**
 * A stretch of the route, in metres along it, that meets another pass at one
 * height, the metres of that pass it meets, and which of the two it is
 * (CROSSES, JOINS, JOINED): where the road's paint gives way to the other
 * road's (meetingAt).
 */
export type Meeting = readonly [
	from: number,
	to: number,
	otherFrom: number,
	otherTo: number,
	as: number,
];

/**
 * Where the route's passes meet as roads do: every crossing at one height,
 * each pass until the other is CLEAR_M off, longer the shallower the angle;
 * and every stretch a later pass eases onto an earlier one or off it
 * (shared-road.ts), a road joining a road.
 */
export function meetingsOf(
	crossings: readonly Crossing[],
	joins: readonly {
		from: number;
		to: number;
		onFrom: number;
		onTo: number;
	}[] = [],
): Meeting[] {
	const out: Meeting[] = [];
	for (const c of crossings) {
		if (Math.abs(c.rise) > LEVEL_UP_TO_M) continue;
		const sin = Math.sin((Math.max(c.angle, 5) * Math.PI) / 180);
		const reach = Math.min(REACH_MAX_M, CLEAR_M / sin);
		const far = reach + 2 * CLEAR_M;
		out.push(
			[c.a - reach, c.a + reach, c.b - far, c.b + far, CROSSES],
			[c.b - reach, c.b + reach, c.a - far, c.a + far, CROSSES],
		);
	}
	for (const j of joins) {
		out.push(
			[
				j.from - CLEAR_M,
				j.to + CLEAR_M,
				j.onFrom - CLEAR_M,
				j.onTo + CLEAR_M,
				JOINS,
			],
			// Only the stretch it eases over: further on it lies on the earlier pass, and is not drawn.
			[j.onFrom - CLEAR_M, j.onTo + CLEAR_M, j.from, j.to, JOINED],
		);
	}
	return out.sort((p, q) => p[0] - q[0]);
}

type Met = {
	bare?: readonly Meeting[];
	x: ArrayLike<number>;
	z: ArrayLike<number>;
	step: number;
	length: number;
};

/**
 * How far the point (x, z) of the road at metre `d` lies from the centre
 * line of a pass it meets there, metres, CLEAR_M at the most, and which of
 * the two it is; CLEAR_M where it meets none. Never signed by its side: a
 * vertex beside one CLEAR_M off would draw the centre line between them. The
 * road's paint reads it (geometry.ts). At a crossing, inside the other
 * pass's asphalt a pass is asphalt, no line and no shoulder, and its lines
 * stop at the other's shoulder: the two ribbons paint every spot they share
 * alike, a crossroads whatever the angle. A pass joining an earlier one is
 * not drawn inside its asphalt, and the earlier one keeps its paint: a road
 * running into a road, never two ribbons through one another.
 */
export function meetingAt(
	route: Met,
	d: number,
	x: number,
	z: number,
): [off: number, as: number] {
	if (!route.bare) return [CLEAR_M, CROSSES];
	const L = route.length;
	const dd = d < 0 || d > L ? ((d % L) + L) % L : d;
	let best = CLEAR_M;
	let as = CROSSES;
	const last = route.x.length - 2;
	for (const [from, to, otherFrom, otherTo, role] of route.bare) {
		if (dd < from || dd > to) continue;
		const i0 = Math.max(0, Math.floor(otherFrom / route.step));
		const i1 = Math.min(last, Math.ceil(otherTo / route.step) - 1);
		for (let i = i0; i <= i1; i++) {
			const sx = route.x[i + 1] - route.x[i];
			const sz = route.z[i + 1] - route.z[i];
			const px = x - route.x[i];
			const pz = z - route.z[i];
			const t = Math.min(
				1,
				Math.max(0, (px * sx + pz * sz) / (sx * sx + sz * sz || 1)),
			);
			const off = Math.hypot(px - sx * t, pz - sz * t);
			if (off < best) {
				best = off;
				as = role;
			}
		}
	}
	return [best, as];
}

type Line = {
	x: ArrayLike<number>;
	z: ArrayLike<number>;
	ele: ArrayLike<number>;
	step: number;
	length: number;
	loop?: boolean;
	/** Per sample, how far it is drawn on an earlier pass (shared-road.ts). */
	shared?: ArrayLike<number>;
};

/** A pass drawn on an earlier one that meets a pass shallower than this, in degrees, lies along it. */
const ALONG_DEG = 30;

export function crossingsOf(route: Line): Crossing[] {
	const { x, z, ele, step } = route;
	const n = x.length - 1; // segments
	if (n < 2) return [];
	const cell = Math.max(step * 4, 20);
	const grid = new Map<string, number[]>();
	const key = (cx: number, cz: number) => `${cx},${cz}`;
	const out: Crossing[] = [];
	const apart = Math.ceil(APART_M / step);
	for (let j = 0; j < n; j++) {
		const x0 = Math.min(x[j], x[j + 1]);
		const x1 = Math.max(x[j], x[j + 1]);
		const z0 = Math.min(z[j], z[j + 1]);
		const z1 = Math.max(z[j], z[j + 1]);
		const seen = new Set<number>();
		const cells: string[] = [];
		for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++)
			for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++) {
				const k = key(cx, cz);
				cells.push(k);
				for (const i of grid.get(k) ?? []) {
					if (seen.has(i) || j - i < apart) continue;
					// A loop's last metres meet its first: its closure, not a crossing.
					if (route.loop && i + (n - j) < apart) continue;
					seen.add(i);
					const hit = meet(x, z, i, j);
					if (!hit) continue;
					const [t, u] = hit;
					const ha = ele[i] + (ele[i + 1] - ele[i]) * t;
					const hb = ele[j] + (ele[j + 1] - ele[j]) * u;
					const dot =
						(x[i + 1] - x[i]) * (x[j + 1] - x[j]) +
						(z[i + 1] - z[i]) * (z[j + 1] - z[j]);
					const la = Math.hypot(x[i + 1] - x[i], z[i + 1] - z[i]);
					const lb = Math.hypot(x[j + 1] - x[j], z[j + 1] - z[j]);
					const cos = Math.min(1, Math.abs(dot) / (la * lb || 1));
					const angle = (Math.acos(cos) * 180) / Math.PI;
					// A pass drawn on an earlier one lies on its line, and the two lines touch all along it: one road, not a crossing a sample.
					if (
						route.shared &&
						angle < ALONG_DEG &&
						Math.max(route.shared[j], route.shared[j + 1]) > 0
					)
						continue;
					out.push({
						a: (i + t) * step,
						b: (j + u) * step,
						x: x[i] + (x[i + 1] - x[i]) * t,
						z: z[i] + (z[i + 1] - z[i]) * t,
						rise: hb - ha,
						angle,
					});
				}
			}
		for (const k of cells) {
			const list = grid.get(k);
			if (list) list.push(j);
			else grid.set(k, [j]);
		}
	}
	return out.sort((p, q) => p.b - q.b);
}

/** Where segments i and j meet, as a share along each, or null. */
function meet(
	x: ArrayLike<number>,
	z: ArrayLike<number>,
	i: number,
	j: number,
): [number, number] | null {
	const rx = x[i + 1] - x[i];
	const rz = z[i + 1] - z[i];
	const sx = x[j + 1] - x[j];
	const sz = z[j + 1] - z[j];
	const d = rx * sz - rz * sx;
	if (Math.abs(d) < 1e-9) return null; // parallel: alongside, never across
	const qx = x[j] - x[i];
	const qz = z[j] - z[i];
	const t = (qx * sz - qz * sx) / d;
	const u = (qx * rz - qz * rx) / d;
	// Half-open, so a crossing on a shared sample is counted once.
	return t >= 0 && t < 1 && u >= 0 && u < 1 ? [t, u] : null;
}

/** One pass further over the other than this is a road high above a road, a spiral or a stack of hairpins: left as recorded. */
export const LEVEL_UP_TO_M = 12;
/** Metres along each pass over which it eases to the crossing's height, at the least. */
const EASE_M = 60;
/** And metres of easing per metre a pass moves: 4 m of it eases over 200 m, so the drawn grade is off the ridden one by 3 % at most. */
const EASE_PER_M = 50;

/**
 * The route's heights with every crossing drawn level: a crossroads. The
 * ground has one height at a spot, so two passes meeting at two heights drew
 * one road through the other's bank. Each pass takes half the difference,
 * eased along its own line. Only where the world draws it, as a shared road
 * is (shared-road.ts): the ride's metres and grades stay as recorded. Null
 * where nothing crosses, or nothing that does needs moving.
 */
export function levelCrossings(route: Line): Float64Array | null {
	const found = crossingsOf(route).filter(
		(c) => Math.abs(c.rise) > 0.01 && Math.abs(c.rise) <= LEVEL_UP_TO_M,
	);
	if (found.length === 0) return null;
	const ele = Float64Array.from(route.ele);
	const ease = (at: number, by: number) => {
		const reach = Math.max(EASE_M, Math.abs(by) * EASE_PER_M);
		const from = Math.max(0, Math.ceil((at - reach) / route.step));
		const to = Math.min(ele.length - 1, Math.floor((at + reach) / route.step));
		for (let i = from; i <= to; i++) {
			const t = 1 - Math.abs(i * route.step - at) / reach;
			ele[i] += by * t * t * (3 - 2 * t);
		}
	};
	for (const c of found) {
		ease(c.a, c.rise / 2);
		ease(c.b, -c.rise / 2);
	}
	return ele;
}
