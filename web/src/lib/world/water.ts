// A designed road's water as the stage draws it (designed.ts): each lake and
// river a sheet at its level, laid on the ground's own 10 m lattice and cut
// on the ground's diagonals, so the water's depth over the drawn bed is
// known at every vertex and runs to 0 exactly where the drawn ground comes
// out of it — the shore the rider sees. A stream is a strip down its course,
// each cross-section at its own level. The shader paints the depth in flat
// bands (a bright line at the waterline, a pale shallow band, the water, the
// deep), lets the foam line breathe, moves streaks downstream on running
// water and white where it falls, and sets a few glints on still water.
import * as THREE from 'three';
import type { Route } from '#lib/road/route.ts';
import { FREEBOARD_M, type Water } from './designed';
import { FINE_M } from './place/lattice';
import { yOf } from './road-surface';
import type { Style } from './styles';

/** Depths, metres over the drawn bed, at which the water's bands change: from the shallows to the water, to the deep, to the deepest. */
export const WATER_BANDS = { shallow: 1.6, water: 6, deep: 18 };
/** Metres out from the waterline the foam line reaches, lapping a little either way. */
export const WATERLINE_M = 0.7;
/** Metres either side of the shore within which the depth is read off the drawn ground: the waterline lies within a fine cell of it. */
const READ_M = 12;
/** Metres out past the shore the sheet reaches at the most: the ground there stands over the water. */
const OUT_M = 30;
/** Metres past which a corner's distance to the shore is not looked for: it is far. */
const CAP_M = 130;
/** Metres from the shore past which a whole chunk of water is one quad: all of it deepest. */
const OPEN_M = 100;
/** Metres of water, at every corner of a block, over which a block of the lattice is drawn as one quad: no waterline crosses it. */
const MERGE_DEEP_M = 1;
/** A river's flow, metres a second; a stream's from its fall. */
const RIVER_MPS = 1.1;
const STREAM_MPS = [1.6, 9] as const;
/** A stream's water at its middle, metres: its foam line hugs its banks. */
const STREAM_MID_M = 1.1;

type Pt = readonly [number, number];

/** Segments of a line, bucketed by 40 m cells, for the nearest point within a reach. */
function segments(pts: readonly Pt[], closed: boolean) {
	const CELL = 40;
	const n = pts.length;
	const count = closed ? n : n - 1;
	const along = new Float64Array(count + 1);
	for (let i = 0; i < count; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % n];
		along[i + 1] = along[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
	}
	const buckets = new Map<number, number[]>();
	const key = (i: number, j: number) => i * 100_003 + j;
	for (let s = 0; s < count; s++) {
		const a = pts[s];
		const b = pts[(s + 1) % n];
		for (
			let i = Math.floor(Math.min(a[0], b[0]) / CELL);
			i <= Math.floor(Math.max(a[0], b[0]) / CELL);
			i++
		)
			for (
				let j = Math.floor(Math.min(a[1], b[1]) / CELL);
				j <= Math.floor(Math.max(a[1], b[1]) / CELL);
				j++
			) {
				const k = key(i, j);
				const list = buckets.get(k);
				if (list) list.push(s);
				else buckets.set(k, [s]);
			}
	}
	/** The nearest point within `reach`: metres to it, metres along the line to it, and which side (+1 left of the line's way). */
	const nearest = (x: number, z: number, reach: number) => {
		const r = Math.ceil(reach / CELL);
		const ci = Math.floor(x / CELL);
		const cj = Math.floor(z / CELL);
		let best = reach * reach;
		let at = -1;
		let tAt = 0;
		for (let i = ci - r; i <= ci + r; i++)
			for (let j = cj - r; j <= cj + r; j++) {
				const list = buckets.get(key(i, j));
				if (!list) continue;
				for (const s of list) {
					const a = pts[s];
					const b = pts[(s + 1) % n];
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
					if (d < best) {
						best = d;
						at = s;
						tAt = t;
					}
				}
			}
		if (at < 0) return null;
		const a = pts[at];
		const b = pts[(at + 1) % n];
		const side =
			(b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) > 0 ? 1 : -1;
		return {
			d: Math.sqrt(best),
			along: along[at] + (along[at + 1] - along[at]) * tAt,
			side,
		};
	};
	/** Whether any segment may lie within `reach` of (x, z): a cheap no for the most of a long river's box. */
	const within = new Map<number, Set<number>>();
	const mayReach = (x: number, z: number, reach: number) => {
		const r = Math.ceil(reach / CELL);
		let cells = within.get(r);
		if (!cells) {
			cells = new Set();
			for (const k of buckets.keys()) {
				const bi = Math.round(k / 100_003);
				const bj = k - bi * 100_003;
				for (let i = bi - r; i <= bi + r; i++)
					for (let j = bj - r; j <= bj + r; j++) cells.add(key(i, j));
			}
			within.set(r, cells);
		}
		return cells.has(key(Math.floor(x / CELL), Math.floor(z / CELL)));
	};
	return Object.assign(nearest, { mayReach });
}

/** Where a closed outline crosses the line z = `z`, west to east. */
function crossings(ring: readonly Pt[], z: number): number[] {
	const xs: number[] = [];
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, zi] = ring[i];
		const [xj, zj] = ring[j];
		if (zi > z !== zj > z) xs.push(((xj - xi) * (z - zi)) / (zj - zi) + xi);
	}
	return xs.sort((a, b) => a - b);
}

/** A point on the waterline, for what grows and lies at a shore (shore.ts). */
export type ShorePoint = {
	x: number;
	z: number;
	/** The water's level there, metres above sea. */
	level: number;
	/** How steeply the dry ground rises from it, metres a metre. */
	bank: number;
	/** The white water's share there: 0 on still water. */
	foam: number;
	/** Running water (a stream), or still (a lake, a river). */
	running: boolean;
	/** Its own number, 0–1, the same on every screen. */
	k: number;
};

/** A number 0–1 for two integers, the same on every screen. */
const hash2 = (a: number, b: number) =>
	(Math.imul(Math.imul(a, 73856093) ^ Math.imul(b, 19349663), 2654435761) >>>
		0) /
	2 ** 32;

/** The geometry's arrays as they are filled. */
type Out = {
	pos: number[];
	depth: number[];
	flow: number[];
	foam: number[];
	index: number[];
};

/**
 * A lake or a river: its sheet on the lattice over every cell the water
 * reaches, each corner's depth over the drawn ground near the shore and the
 * design's bed past it, whole chunks of open water a quad each.
 */
function still(
	route: Route,
	w: Water,
	groundAt: (x: number, z: number) => number,
	out: Out,
	shore?: ShorePoint[],
) {
	const ring = w.outline;
	const bed = w.bed ?? { slope: 0.3, deep: 25 };
	const y = yOf(route, w.level);
	const banks = segments(ring, true);
	const course = w.course ? segments(w.course, false) : null;
	let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const [x, z] of ring) {
		x0 = Math.min(x0, x);
		z0 = Math.min(z0, z);
		x1 = Math.max(x1, x);
		z1 = Math.max(z1, z);
	}
	const S = FINE_M;
	// Whole 160 m chunks of open water on the ground's own chunks: the lattice's origin is the world's.
	const i0 = Math.floor((x0 - OUT_M) / 160) * 16;
	const j0 = Math.floor((z0 - OUT_M) / 160) * 16;
	const ni = Math.ceil((x1 + OUT_M) / S) - i0;
	const nj = Math.ceil((z1 + OUT_M) / S) - j0;
	const row = ni + 1;
	const sd = new Float32Array(row * (nj + 1));
	const depth = new Float32Array(row * (nj + 1)).fill(NaN);
	const vertex = new Int32Array(row * (nj + 1)).fill(-1);
	// Each corner's distance to the shore, + inside: the inside by the outline's crossings of its row.
	for (let j = 0; j <= nj; j++) {
		const z = (j0 + j) * S;
		const xs = crossings(ring, z);
		let k = 0;
		for (let i = 0; i <= ni; i++) {
			const x = (i0 + i) * S;
			while (k < xs.length && xs[k] < x) k++;
			const wet = k % 2 === 1;
			const near = banks.mayReach(x, z, CAP_M) ? banks(x, z, CAP_M) : null;
			sd[j * row + i] = (near ? near.d : CAP_M) * (wet ? 1 : -1);
		}
	}
	const depthAt = (c: number) => {
		if (Number.isNaN(depth[c])) {
			const s = sd[c];
			// The design's bed past the shore's band, and its bank out of it: the drawn ground's own across it.
			depth[c] =
				s >= READ_M
					? Math.min(bed.deep, FREEBOARD_M + bed.slope * s)
					: s <= -READ_M
						? -FREEBOARD_M
						: w.level -
							groundAt((i0 + (c % row)) * S, (j0 + Math.floor(c / row)) * S);
		}
		return depth[c];
	};
	const vertexOf = (i: number, j: number) => {
		const c = j * row + i;
		if (vertex[c] >= 0) return vertex[c];
		const x = (i0 + i) * S;
		const z = (j0 + j) * S;
		vertex[c] = out.pos.length / 3;
		out.pos.push(x, y, z);
		out.depth.push(depthAt(c));
		const run = course?.(x, z, CAP_M);
		out.flow.push(
			run ? run.along : 0,
			run ? run.d * run.side : 0,
			run ? RIVER_MPS : 0,
		);
		out.foam.push(0);
		return vertex[c];
	};
	/** Two triangles over a block, cut on the ground's diagonal: from its south-east corner to its north-west. */
	const quad = (i: number, j: number, n: number) => {
		const a = vertexOf(i, j);
		const b = vertexOf(i + n, j);
		const c = vertexOf(i, j + n);
		const d = vertexOf(i + n, j + n);
		out.index.push(a, c, b, b, c, d);
	};
	const corner = (i: number, j: number) => sd[j * row + i];
	const minCorner = (i: number, j: number, n: number) =>
		Math.min(
			corner(i, j),
			corner(i + n, j),
			corner(i, j + n),
			corner(i + n, j + n),
		);
	const taken = new Uint8Array(ni * nj);
	/** Whether every cell of an n × n block is open water, none taken yet, every corner `from` metres or more in. */
	const open = (i: number, j: number, n: number, from: number) => {
		if (i + n > ni || j + n > nj) return false;
		for (let b = j; b <= j + n; b++)
			for (let a = i; a <= i + n; a++) if (corner(a, b) < from) return false;
		for (let b = j; b < j + n; b++)
			for (let a = i; a < i + n; a++) if (taken[b * ni + a]) return false;
		return true;
	};
	const take = (i: number, j: number, n: number) => {
		for (let b = j; b < j + n; b++) taken.fill(1, b * ni + i, b * ni + i + n);
	};
	for (let j = 0; j + 16 <= nj; j += 16)
		for (let i = 0; i + 16 <= ni; i += 16)
			if (open(i, j, 16, OPEN_M)) {
				quad(i, j, 16);
				take(i, j, 16);
			}
	// Then blocks under water at every corner, deep enough that no waterline crosses them.
	const under = (i: number, j: number, n: number) => {
		if (!open(i, j, n, 0)) return false;
		for (let b = j; b <= j + n; b++)
			for (let a = i; a <= i + n; a++)
				if (depthAt(b * row + a) < MERGE_DEEP_M) return false;
		return true;
	};
	for (const n of [4, 2])
		for (let j = 0; j + n <= nj; j += n)
			for (let i = 0; i + n <= ni; i += n)
				if (under(i, j, n)) {
					quad(i, j, n);
					take(i, j, n);
				}
	for (let j = 0; j < nj; j++)
		for (let i = 0; i < ni; i++) {
			if (taken[j * ni + i]) continue;
			const lo = minCorner(i, j, 1);
			const hi = Math.max(
				corner(i, j),
				corner(i + 1, j),
				corner(i, j + 1),
				corner(i + 1, j + 1),
			);
			if (hi < -OUT_M) continue;
			// Wet where any corner of it lies under the water: the ground hides the rest.
			if (lo < READ_M) {
				const wet = Math.max(
					depthAt(j * row + i),
					depthAt(j * row + i + 1),
					depthAt((j + 1) * row + i),
					depthAt((j + 1) * row + i + 1),
				);
				if (wet <= 0) continue;
			}
			quad(i, j, 1);
		}
	if (!shore) return;
	// The waterline: where an edge of the lattice runs out of the water, the drawn shore crosses it.
	const edge = (
		c0: number,
		c1: number,
		x0: number,
		z0: number,
		x1: number,
		z1: number,
		salt: number,
	) => {
		if (Math.abs(sd[c0]) >= READ_M || Math.abs(sd[c1]) >= READ_M) return;
		const a = depth[c0];
		const b = depth[c1];
		if (Number.isNaN(a) || Number.isNaN(b) || a > 0 === b > 0) return;
		const t = a / (a - b);
		const dry = Math.max(-a, -b);
		shore.push({
			x: x0 + (x1 - x0) * t,
			z: z0 + (z1 - z0) * t,
			level: w.level,
			bank: dry / (S * (a > 0 ? 1 - t : t) || 1),
			foam: 0,
			running: false,
			k: hash2(Math.round(x0 + x1) + salt, Math.round(z0 + z1)),
		});
	};
	for (let j = 0; j < nj; j++)
		for (let i = 0; i < ni; i++) {
			const c = j * row + i;
			const x = (i0 + i) * S;
			const z = (j0 + j) * S;
			edge(c, c + 1, x, z, x + S, z, 0);
			edge(c, c + row, x, z, x, z + S, 1);
		}
}

/** A stream: a strip down its course, its banks and its middle, each cross-section at its own level. */
function running(route: Route, w: Water, out: Out, shore?: ShorePoint[]) {
	const run = w.run!;
	const n = run.levels.length;
	const last = w.outline.length - 1;
	let along = 0;
	const first = out.pos.length / 3;
	for (let i = 0; i < n; i++) {
		const l = w.outline[i];
		const r = w.outline[last - i];
		const mx = (l[0] + r[0]) / 2;
		const mz = (l[1] + r[1]) / 2;
		if (i > 0) {
			const pl = w.outline[i - 1];
			const pr = w.outline[last - i + 1];
			along += Math.hypot(mx - (pl[0] + pr[0]) / 2, mz - (pl[1] + pr[1]) / 2);
		}
		const half = Math.hypot(l[0] - r[0], l[1] - r[1]) / 2;
		const a = Math.max(0, i - 1);
		const b = Math.min(n - 1, i + 1);
		const span = Math.max(1, b - a) * 10;
		const fall = Math.max(0, (run.levels[a] - run.levels[b]) / span);
		const mps = Math.min(STREAM_MPS[1], STREAM_MPS[0] + 8 * fall);
		const y = yOf(route, run.levels[i]);
		if (shore)
			for (const [side, p] of [
				[0, l],
				[1, r],
			] as const)
				shore.push({
					x: p[0],
					z: p[1],
					level: run.levels[i],
					bank: 1,
					foam: run.foam[i],
					running: true,
					k: hash2(Math.round(p[0] * 10) + side, Math.round(p[1] * 10)),
				});
		for (const [x, z, u, d] of [
			[l[0], l[1], half, 0],
			[mx, mz, 0, STREAM_MID_M],
			[r[0], r[1], -half, 0],
		] as const) {
			out.pos.push(x, y, z);
			out.depth.push(d);
			out.flow.push(along, u, mps);
			out.foam.push(run.foam[i]);
		}
	}
	for (let i = 0; i < n - 1; i++)
		for (let k = 0; k < 2; k++) {
			const a = first + i * 3 + k;
			const b = a + 1;
			const c = a + 3;
			const d = a + 4;
			out.index.push(a, b, c, b, d, c);
		}
}

/**
 * The scene's water as one geometry: position, `depth` (metres over the drawn
 * bed), `flow` (metres along its course, metres across it, metres a second;
 * 0 for standing water) and `foam` (its white water's share).
 */
export function waterSheets(
	route: Route,
	waters: readonly Water[],
	/** The drawn ground's height, metres above sea. */
	groundAt: (x: number, z: number) => number,
	/** Filled with the waterline's points, where given. */
	shore?: ShorePoint[],
): THREE.BufferGeometry {
	const out: Out = { pos: [], depth: [], flow: [], foam: [], index: [] };
	for (const w of waters)
		if (w.run) running(route, w, out, shore);
		else still(route, w, groundAt, out, shore);
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
	g.setAttribute('depth', new THREE.Float32BufferAttribute(out.depth, 1));
	g.setAttribute('flow', new THREE.Float32BufferAttribute(out.flow, 3));
	g.setAttribute('foam', new THREE.Float32BufferAttribute(out.foam, 1));
	g.setIndex(out.index);
	g.computeBoundingSphere();
	return g;
}

/** The water's colours: a look's own, or made from its water and its snow where it names none. */
export function waterColors(style: Style) {
	const own = style.water;
	if (own) return own;
	const mid = new THREE.Color(style.props.water);
	const hex = (c: THREE.Color) => `#${c.getHexString()}`;
	return {
		deep: hex(mid.clone().multiplyScalar(0.62)),
		mid: style.props.water,
		shallow: hex(mid.clone().lerp(new THREE.Color('#9fe0d8'), 0.45)),
		foam: style.palette[5],
	};
}

/**
 * The water's material: lit, fogged and stepped as the ground is (it takes
 * the ground material's light uniforms, so a change of light moves both),
 * and drawn as land in Diorama 3D, with no ink line of its own.
 */
export function waterMaterial(
	style: Style,
	ground: THREE.ShaderMaterial,
): THREE.ShaderMaterial {
	const c = waterColors(style);
	const u = ground.uniforms;
	const B = WATER_BANDS;
	return new THREE.ShaderMaterial({
		side: THREE.DoubleSide,
		uniforms: {
			uSun: u.uSun,
			uFrom: u.uFrom,
			uDusk: u.uDusk,
			uKey: u.uKey,
			uShade: u.uShade,
			uSkyTop: u.uSkyTop,
			uHorizon: u.uHorizon,
			uSunward: u.uSunward,
			uFogK: u.uFogK,
			uSkyFill: u.uSkyFill,
			uDiorama: u.uDiorama,
			uTime: u.uTime,
			uDeep: { value: new THREE.Color(c.deep) },
			uMid: { value: new THREE.Color(c.mid) },
			uShallow: { value: new THREE.Color(c.shallow) },
			uFoam: { value: new THREE.Color(c.foam) },
		},
		vertexShader: /* glsl */ `
			attribute float depth;
			attribute vec3 flow;
			attribute float foam;
			varying vec3 vPos; varying float vDepth; varying vec3 vFlow; varying float vFoam;
			void main() {
				vDepth = depth; vFlow = flow; vFoam = foam;
				vec4 world = modelMatrix * vec4(position, 1.0);
				vPos = world.xyz;
				gl_Position = projectionMatrix * viewMatrix * world;
			}`,
		fragmentShader: /* glsl */ `
			uniform vec3 uSun, uFrom, uKey, uShade, uSkyTop, uHorizon, uSunward, uDeep, uMid, uShallow, uFoam;
			uniform float uFogK, uSkyFill, uDusk, uDiorama, uTime;
			varying vec3 vPos; varying float vDepth; varying vec3 vFlow; varying float vFoam;
			float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
			float vnoise(vec2 p) {
				vec2 i = floor(p), f = fract(p);
				f = f * f * (3.0 - 2.0 * f);
				return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
			}
			void main() {
				vec3 view = vPos - cameraPosition;
				float dist = length(view);
				view /= dist;
				float speed = vFlow.z;
				// The bands' edges wander a little, so none traces the lattice; the foam line laps in and out.
				float d = vDepth * (1.0 + (vnoise(vPos.xz / 9.0) - 0.5) * 0.3);
				float fw = fwidth(d) * 0.75 + 1e-4;
				vec3 c = mix(uShallow, uMid, smoothstep(${B.shallow.toFixed(2)} - fw, ${B.shallow.toFixed(2)} + fw, d));
				c = mix(c, uDeep, smoothstep(${B.water.toFixed(2)} - fw, ${B.water.toFixed(2)} + fw, d));
				c = mix(c, uDeep * 0.82, smoothstep(${B.deep.toFixed(2)} - fw, ${B.deep.toFixed(2)} + fw, d));
				// The foam line: metres from the waterline, whatever the slope of the bed — the depth over how fast it deepens.
				float grad = max(length(vec2(dFdx(vDepth), dFdy(vDepth))) / max(length(vec2(length(dFdx(vPos.xz)), length(dFdy(vPos.xz)))), 1e-4), 0.02);
				float out_ = vDepth / grad;
				float lap = ${WATERLINE_M.toFixed(2)} * (1.0 + 0.4 * sin(uTime * 1.1 + vnoise(vPos.xz / 14.0) * 12.0));
				float fo = fwidth(out_) * 0.75 + 1e-4;
				float line = 1.0 - smoothstep(lap - fo, lap + fo, out_);
				float near = 1.0 - smoothstep(220.0, 320.0, dist);
				if (speed > 0.0) {
					// Running water: streaks in lanes, moving down its course; white where it falls, its streaks darker.
					float lane = floor(vFlow.y / 1.6);
					float inLane = abs(fract(vFlow.y / 1.6) - 0.5);
					float white = smoothstep(0.3, 0.7, vFoam);
					// Slow water: a few long thin streaks; white water: short ones, many, fast.
					float len = mix(9.0, 3.0, white);
					float q = (vFlow.x - uTime * speed) / len + h21(vec2(lane, 7.0)) * 9.0;
					float k = h21(vec2(lane, floor(q)));
					float dash = step(mix(0.8, 0.45, white), k) * step(fract(q), mix(0.45, 0.6, white)) * step(inLane, mix(0.12, 0.3, white)) * near;
					// White water in cascades: a white lip every few metres down it, pale water between.
					float at = fract((vFlow.x + 1.2 * sin(vFlow.y * 1.3)) / 7.0);
					float lip = smoothstep(0.0, 0.06, at) * (1.0 - smoothstep(0.32, 0.4, at));
					lip = mix(0.5, lip, 1.0 - smoothstep(300.0, 600.0, dist));
					c = mix(c, mix(uShallow, uFoam, 0.4 + 0.55 * lip), white);
					c = mix(c, white > 0.5 ? uFoam : mix(c, uFoam, 0.6), dash);
				}
				c = mix(c, uFoam, line);
				// Lit as the ground is, its face flat: the room's four steps in Diorama 3D.
				float lam = uFrom.y * 0.5 + 0.5;
				if (uDiorama > 0.5) lam = floor(lam * 4.0 + 0.5) / 4.0;
				vec3 col = c * mix(uShade * 2.2 + 0.15, uKey, lam) + c * uSkyTop * uSkyFill;
				// The sky in it, mostly at a glance along it.
				vec3 up = vec3(0.0, 1.0, 0.0);
				vec3 seen = reflect(view, up);
				float sunward = pow(max(dot(seen, uSun), 0.0), 6.0);
				float fres = 0.02 + 0.98 * pow(1.0 - max(-view.y, 0.0), 5.0);
				col = mix(col, mix(mix(uHorizon, uSkyTop, 0.45), uSunward, sunward), fres * 0.24 * (1.0 - line));
				// Glints on still water: a short dash across the view, now and then, in one cell in three.
				vec2 cell = floor(vPos.xz / 3.5);
				float k = h21(cell);
				float life = fract(k * 17.3 + uTime * 0.21);
				vec2 p = vPos.xz - (cell + 0.5) * 3.5;
				vec2 across = normalize(vec2(-view.z, view.x) + 1e-5);
				float a = abs(dot(p, across));
				float b = abs(dot(p, vec2(across.y, -across.x)));
				float thick = max(0.14, fwidth(b) * 1.2);
				float glint = step(0.74, k) * step(life, 0.16) * step(a, 0.9 * sin(life / 0.16 * 3.1416)) * step(b, thick) * near
					* step(speed, 0.0) * step(${B.shallow.toFixed(2)}, d);
				col = mix(col, mix(uKey, vec3(1.0), 0.35), glint * (0.45 + 0.45 * sunward));
				vec3 fogCol = mix(uHorizon, uSunward, pow(max(dot(view, uSun), 0.0), 8.0));
				vec3 ext = exp(-dist * uFogK * vec3(1.3, 1.0, 0.75));
				gl_FragColor = vec4(mix(fogCol, col, ext) * uDusk, 1.0);
				if (uDiorama > 0.5) gl_FragColor.a = 0.5; // land, for the ink pass (diorama.ts)
				#include <colorspace_fragment>
			}`,
	});
}
