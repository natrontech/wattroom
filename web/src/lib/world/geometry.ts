// World → three.js buffers. Pure data in, geometry out; the scene decides
// materials, so one world can be drawn in any art style.
import * as THREE from 'three';
import { Biome } from './biome';
import { type RoutePoint } from '#lib/road/along.ts';
import { type Route } from '#lib/road/route.ts';
import { lightsUniforms, POOL, type Lights } from './lights';
import type { Palette, Style } from './styles';
import type { TerrainMesh } from './terrain-mesh';
import type { World } from './world';
import { meetingAt } from './crossings';
import { sceneOf } from './designed';
import { smoothstep } from './rand';
import { sharedAt } from './shared-road';
import { flatAt, ROAD_LIFT, seatOf, yOf } from './road-surface';
import { BANK_SPAN_M, banksOf, bendsOf } from './terrain/road-frame';
import {
	FORMATION,
	ribbonRows,
	ROAD_W,
	GRAVEL_EDGE,
	GRAVEL_W,
	SHOULDER,
	SHOULDER_DROP,
} from './terrain/road-profile';

export { ROAD_W } from './terrain/road-profile';

export { GRAVEL_EDGE, GRAVEL_W } from './terrain/road-profile';

/** How wide a road's ribbon is drawn, its surface and the shoulder each side: a gravel lane's narrow, with a grass edge. */
export const ribbonOf = (route: Pick<Route, 'gravel'>) =>
	route.gravel
		? { width: GRAVEL_W, shoulder: GRAVEL_EDGE }
		: { width: ROAD_W, shoulder: SHOULDER };
export { EXAG, ROAD_LIFT, surfaceOf, yOf } from './road-surface';

/** A ploughed bank's height over the asphalt at the formation's edge, and the metres of height either side of the snowline over which the snow comes in. */
const SNOW_BANK_M = 0.9;
const SNOW_EASE_M = 12;

/** A road's galleries and tunnels in metres along it (designed.ts), found once a road: under a roof no bank is ploughed up. */
const roofs = new WeakMap<Route, [number, number][]>();
function roofedOf(route: Route): [number, number][] {
	let spans = roofs.get(route);
	if (spans) return spans;
	const metre = ([x, z]: [number, number]) => {
		let best = 30;
		let at = -1;
		for (let i = 0; i < route.x.length; i++) {
			const d = Math.hypot(route.x[i] - x, route.z[i] - z);
			if (d < best) {
				best = d;
				at = i * route.step;
			}
		}
		return at;
	};
	const scene = sceneOf(route.scene);
	spans = [...(scene?.galleries ?? []), ...(scene?.tunnels ?? [])].flatMap(
		([a, b]) => {
			const [from, to] = [metre(a), metre(b)].sort((p, q) => p - q);
			return from < 0 ? [] : [[from, to] as [number, number]];
		},
	);
	roofs.set(route, spans);
	return spans;
}

/** Which of the land shader's covers a biome is dressed as: snow, rock, sparse grass, bog (styles.ts dioramaLand). */
const COVER_OF: Partial<Record<Biome, number>> = {
	[Biome.Snow]: 0,
	[Biome.Frost]: 0,
	[Biome.Rock]: 1,
	[Biome.Alpine]: 2,
	[Biome.Dry]: 2,
	[Biome.Moor]: 3,
};

export function terrain(
	route: Route,
	mesh: TerrainMesh,
	palette: Palette,
): THREE.BufferGeometry {
	const { pos, biome, shade, forest, index } = mesh;
	const n = pos.length / 3;
	const p = new Float32Array(n * 3);
	const colors = new Float32Array(n * 3);
	const ao = new Float32Array(n);
	// What the land shader dresses each vertex as (styles.ts): snow, rock, sparse grass, bog.
	const cover = new Uint8Array(n * 4);
	const cache = new Map<number, THREE.Color>();
	for (const [k, v] of Object.entries(palette))
		cache.set(Number(k), new THREE.Color(v));
	const meadow = cache.get(Biome.Meadow) ?? new THREE.Color();
	const wood = cache.get(Biome.Forest) ?? meadow;
	// A designed scene's ground in a look that names no colour for it: moor between meadow and rock, dry ground a pale pasture, frost snow.
	const made = (b: Biome, from: Biome, to: Biome, t: number) => {
		if (!cache.has(b))
			cache.set(
				b,
				(cache.get(from) ?? meadow).clone().lerp(cache.get(to) ?? meadow, t),
			);
	};
	made(Biome.Moor, Biome.Meadow, Biome.Rock, 0.5);
	made(Biome.Dry, Biome.Alpine, Biome.Snow, 0.3);
	made(Biome.Frost, Biome.Snow, Biome.Snow, 0);
	const mix = new THREE.Color();
	for (let i = 0; i < n; i++) {
		p[i * 3] = pos[i * 3];
		p[i * 3 + 1] = yOf(route, pos[i * 3 + 1]);
		p[i * 3 + 2] = pos[i * 3 + 2];
		const b = biome[i];
		const c =
			b === Biome.Meadow || b === Biome.Forest
				? mix.copy(meadow).lerp(wood, forest[i]) // meadow ↔ forest, blended at the edge
				: (cache.get(b) ?? meadow);
		colors[i * 3] = c.r;
		colors[i * 3 + 1] = c.g;
		colors[i * 3 + 2] = c.b;
		ao[i] = Math.min(1, Math.max(0, (shade[i] - 0.72) / 0.4)); // hollows dark, crests light
		const k = COVER_OF[b as Biome];
		if (k !== undefined) cover[i * 4 + k] = 255;
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(p, 3));
	g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
	g.setAttribute('cover', new THREE.BufferAttribute(cover, 4, true));
	g.setIndex(new THREE.BufferAttribute(index, 1));
	g.computeBoundingSphere();
	return g;
}

// The road, sampled from the same spline riders ride, every 2 m: shoulder,
// edge, centre, edge, shoulder. Banked into bends (≤ 4°) by the bank road
// furniture stands on (banksOf), inside columns clamped to 0.85 × the bend
// radius (bendsOf) so a hairpin never folds into a bow-tie.
// The asphalt is lit as one surface: each row's normal is its banked,
// pitched cross-section's up, edge to edge, and the shoulder's slope lights
// only the shoulder (#4556).
// uv carries (metres across, metres along) for the marking shader.
// `rows` draws only rows [from, to] of the whole ribbon, the same vertices
// and normals the whole would have there: it walks in from WARM rows back and
// lights its ends with the rows beyond them, so pieces meet with no seam.
export function road(
	route: Route,
	opts: {
		width?: number;
		lift?: number;
		shoulder?: number;
		step?: number;
		rows?: readonly [from: number, to: number];
		/** Whether its first end and its last are rounded off: a side road's that ends at another road's edge is cut square (side-roads.ts). */
		caps?: readonly [boolean, boolean];
	} = {},
): THREE.BufferGeometry {
	const half = (opts.width ?? ROAD_W) / 2;
	const lift = opts.lift ?? ROAD_LIFT;
	const shoulder = opts.shoulder ?? 0;
	const step = opts.step ?? 2;
	const offs =
		shoulder > 0
			? [half + shoulder, half, 0, -half, -(half + shoulder)]
			: [half, 0, -half];
	const drops =
		shoulder > 0 ? [-SHOULDER_DROP, 0, 0, 0, -SHOULDER_DROP] : [0, 0, 0];
	const cols = offs.length;
	const snowline = sceneOf(route.scene)?.climate.snowline;
	const roofed = snowline === undefined ? [] : roofedOf(route);
	const [from, to] = opts.rows ?? [0, Infinity];
	// A road that goes round is one strip round (#4534): rows before its first and past its last wrap, so its start line is lit, banked and walked as any other row.
	const rows = ribbonRows(route, step);
	const end = rows.count - 1;
	const first = rows.ring ? from - WARM : Math.max(0, from - WARM);
	const top = Math.min(to, end);
	const last = rows.ring ? top + 1 : Math.min(top + 1, end);
	const centre: RoutePoint[] = [];
	const reach = rows.ring
		? top + 1 + BEND_ROWS
		: Math.min(top + 1 + BEND_ROWS, end);
	for (let k = first; k <= reach; k++) centre.push(rows.row(k));
	const cx = centre.map((p) => p.x);
	const cz = centre.map((p) => p.z);
	const bends = bendsOf(cx, cz);
	const banks = banksOf(cx, cz);
	const pos: number[] = [];
	const sides: THREE.Vector3[] = [];
	const uv: number[] = [];
	const prev: THREE.Vector3[] = [];
	const hidden: boolean[] = [];
	// Through a crossing, each vertex's metres off the pass it meets and which of the two it is (crossings.ts): the paint gives way to the other road's.
	const bare: number[] = [];
	// Where it runs into another road, its vertices seated on that road's carriageway (road-surface.ts), and its asphalt lit as that road's: by vertex, how much, and that plane's up.
	const seat = seatOf(route);
	const seated: number[] = [];
	for (let r = first; r <= last; r++) {
		const p = centre[r - first];
		const d = rows.metre(r);
		const k = bends[r - first]; // curvature, +left
		// A later pass easing onto an earlier one sinks under it, and is not drawn where it is on it (#4531).
		const w = sharedAt(route, d);
		// Its bend onto the earlier one is no road's bend: unbanked as it lands, so it never tilts up through the earlier one.
		// Nor where it laps a roundabout's level arm: banked into its turn onto the ring, its high edge stood through the arm's asphalt.
		const bank = route.level
			? 0
			: banks[r - first] * (1 - w) * (1 - flatAt(route, d));
		const lx = Math.cos(p.heading); // left of travel
		const lz = -Math.sin(p.heading);
		sides.push(new THREE.Vector3(lx, -Math.tan(bank), lz)); // across the asphalt, leftward
		hidden.push(w >= 1);
		const y = yOf(route, p.ele) + lift - SHARED_SINK * w;
		const tx = Math.sin(p.heading);
		const tz = Math.cos(p.heading);
		// In a designed road's snow the plough has thrown a bank up along both edges.
		const banked =
			snowline === undefined || roofed.some(([a, b]) => d >= a && d <= b)
				? 0
				: SNOW_BANK_M *
					smoothstep(snowline - SNOW_EASE_M, snowline + SNOW_EASE_M, p.ele);
		const wide = route.widen?.(d) ?? 1;
		for (let c = 0; c < cols; c++) {
			// Its paint is laid by its own width (uv), so a road drawn wider carries its edge lines out with it.
			let u = offs[c] * wide;
			if (Math.sign(u) === Math.sign(k) && Math.abs(k) > 1e-4)
				u = Math.sign(u) * Math.min(Math.abs(u), 0.85 / Math.abs(k));
			const v = new THREE.Vector3(
				p.x + lx * u,
				y + drops[c] + (drops[c] < 0 ? banked : 0) - u * Math.tan(bank),
				p.z + lz * u,
			);
			// walk the column: never step backwards along the road (a degenerate triangle, not a bow-tie)
			const q = prev[c];
			if (q && (v.x - q.x) * tx + (v.z - q.z) * tz <= 0) v.copy(q);
			const on = seat?.(d, v.x, v.z);
			if (on) {
				// Its own shoulder's drop kept: the two shoulders meet where the higher of them lies, a mitre round the corner.
				const drop = drops[c] + (drops[c] < 0 ? banked : 0);
				v.y += (on.y + drop - v.y) * on.w;
				seated.push(on.w, ...on.up);
			} else seated.push(0, 0, 1, 0);
			prev[c] = v;
			pos.push(v.x, v.y, v.z);
			uv.push(offs[c], d);
			bare.push(...meetingAt(route, d, v.x, v.z));
		}
	}
	// The rows asked for, lit as the whole ribbon lights them.
	const lit = normals(pos, sides, cols);
	if (seat)
		for (let i = 0; i < lit.length / 3; i++) {
			const w = seated[i * 4];
			const c = i % cols;
			// The asphalt's own columns: a shoulder keeps the light of its own slope.
			if (w <= 0 || c === 0 || c === cols - 1) continue;
			const n = new THREE.Vector3(lit[i * 3], lit[i * 3 + 1], lit[i * 3 + 2])
				.lerp(
					new THREE.Vector3(
						seated[i * 4 + 1],
						seated[i * 4 + 2],
						seated[i * 4 + 3],
					),
					w,
				)
				.normalize();
			lit.splice(i * 3, 3, n.x, n.y, n.z);
		}
	const lo = Math.max(from, first);
	const hi = Math.min(top, last);
	const keep = (a: readonly number[], size: number) =>
		a.slice((lo - first) * cols * size, (hi - first + 1) * cols * size);
	const out = {
		pos: keep(pos, 3),
		uv: keep(uv, 2),
		bare: keep(bare, 2),
		normal: keep(lit, 3),
		hidden: hidden.slice(lo - first, hi - first + 1),
	};
	// A road with two ends is rounded off at each (endCap), where it is drawn there: rows of their own after the road's, so a row keeps its number.
	const cuts: number[] = [];
	if (!rows.ring && shoulder > 0) {
		const count = out.hidden.length;
		const [capFirst, capLast] = opts.caps ?? [true, true];
		if (capFirst && lo === 0 && !out.hidden[0])
			endCap(out, cuts, cols, drops, 0, 1);
		if (capLast && hi === end && !out.hidden[count - 1])
			endCap(out, cuts, cols, drops, count - 1, count - 2);
	}
	const g = strip(out.pos, out.uv, cols, out.hidden, cuts);
	g.setAttribute('bare', new THREE.Float32BufferAttribute(out.bare, 2));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
	g.computeBoundingSphere();
	return g;
}

/** Rows a road's rounded end is drawn in, the end row's own again among them: a tenth of a quarter turn each. */
export const CAP_ROWS = 10;

/**
 * A road's end, rounded off: the road used to stop at a square cut, its
 * asphalt and both shoulders sawn through where the first metre began. The
 * end row `at` is swept round its own centre, a quarter turn from each side
 * to meet beyond it: every column keeps its distance from the centre, so the
 * edge line and the shoulder run round the end as half circles, each as
 * wide as along the road. The ground is already levelled there (ground.ts
 * heightAt: within the formation of the road's nearest point). The row's
 * bank eases out round the turn and each column keeps its drop, so the two
 * sides meet at one height. `inner` is the row inside the end: the cap runs
 * on from it. Its rows follow the strip's, cut off from them (`cuts`: no
 * quad after that row).
 */
function endCap(
	g: {
		pos: number[];
		uv: number[];
		bare: number[];
		normal: number[];
		hidden: boolean[];
	},
	cuts: number[],
	cols: number,
	drops: readonly number[],
	at: number,
	inner: number,
) {
	if (inner < 0 || inner >= g.hidden.length) return;
	const row = (a: number[], size: number, r = at) =>
		a.slice(r * cols * size, (r + 1) * cols * size);
	const edge = row(g.pos, 3);
	const mid = ((cols - 1) / 2) * 3;
	// Outward: square to the row, on the side away from the row inside the end.
	const last = (cols - 1) * 3;
	const ax = edge[last] - edge[0];
	const az = edge[last + 2] - edge[2];
	const len = Math.hypot(ax, az);
	if (len < 1e-6) return;
	const before = row(g.pos, 3, inner);
	const away =
		-az * (edge[mid] - before[mid]) + ax * (edge[mid + 2] - before[mid + 2]) < 0
			? -1
			: 1;
	const ox = (-az / len) * away;
	const oz = (ax / len) * away;
	const uvs = row(g.uv, 2);
	const along = at > inner ? 1 : -1;
	const capRows: number[][] = [];
	for (let k = 0; k < CAP_ROWS; k++) {
		const a = (k / (CAP_ROWS - 1)) * (Math.PI / 2);
		const pos: number[] = [];
		const uv: number[] = [];
		for (let c = 0; c < cols; c++) {
			const dx = edge[c * 3] - edge[mid];
			const dz = edge[c * 3 + 2] - edge[mid + 2];
			const reach = Math.hypot(dx, dz) * Math.sin(a);
			const banked = edge[c * 3 + 1] - edge[mid + 1] - drops[c];
			pos.push(
				edge[mid] + dx * Math.cos(a) + ox * reach,
				edge[mid + 1] + drops[c] + banked * Math.cos(a),
				edge[mid + 2] + dz * Math.cos(a) + oz * reach,
			);
			uv.push(uvs[c * 2], uvs[c * 2 + 1] + along * reach);
		}
		capRows.push([...pos, ...uv]);
	}
	// A strip's rows run the road's way: the start's cap from its tip in.
	if (along < 0) capRows.reverse();
	cuts.push(g.hidden.length - 1);
	for (const r of capRows) {
		g.pos.push(...r.slice(0, cols * 3));
		g.uv.push(...r.slice(cols * 3));
		g.bare.push(...row(g.bare, 2));
		g.normal.push(...row(g.normal, 3));
		g.hidden.push(false);
	}
}

/** Rows a piece walks in from, so its columns step as the whole ribbon's do through a hairpin. */
const WARM = 64;
/** Rows past a piece's end its bank reads: banksOf spans BANK_SPAN_M and a segment. */
const BEND_ROWS = Math.ceil(BANK_SPAN_M / 2) + 2;

/** Metres a later pass sinks under an earlier one it is easing onto, so the earlier draws over it (#4531). */
const SHARED_SINK = 0.06;

/**
 * The ribbon's normals (#4556): the asphalt's, edge to edge, is its row's
 * cross-section (`across`, leftward, banked) crossed with the road's way
 * along the centre, so it tilts by the bank and the grade and nothing else.
 * A shoulder's outer column is lit by its own slope. Averaging face normals
 * (computeVertexNormals) lit the asphalt's edges with the shoulder's 13°
 * drop, and the Diorama's banded light drew that tilt as pale patches whose
 * edge wandered with every bend.
 */
function normals(
	pos: readonly number[],
	across: readonly THREE.Vector3[],
	cols: number,
): number[] {
	const rows = across.length;
	const mid = (cols - 1) / 2;
	const at = (r: number, c: number) => {
		const i = (r * cols + c) * 3;
		return new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]);
	};
	const out: number[] = [];
	const along = new THREE.Vector3();
	const up = new THREE.Vector3();
	const side = new THREE.Vector3();
	for (let r = 0; r < rows; r++) {
		along.subVectors(
			at(Math.min(r + 1, rows - 1), mid),
			at(Math.max(r - 1, 0), mid),
		);
		const a = across[r];
		// A row whose centre did not move (a column walked in place): the way along is square to the row.
		if (along.lengthSq() < 1e-8) along.set(-a.z, 0, a.x);
		up.crossVectors(along, a).normalize();
		for (let c = 0; c < cols; c++) {
			const n = up.clone();
			// An outer shoulder column: its slope from the edge, where it has width enough to have one.
			if (cols > 3 && (c === 0 || c === cols - 1)) {
				const edge = at(r, c === 0 ? 1 : cols - 2);
				side.subVectors(at(r, c), edge);
				if (c > 0) side.negate(); // leftward, as `across`
				if (side.x * a.x + side.z * a.z > 0.2)
					n.crossVectors(along, side).normalize();
			}
			out.push(n.x, n.y, n.z);
		}
	}
	return out;
}

/** Quads between rows; none between two `hidden` rows, nor after a row in `cuts`. */
function strip(
	pos: number[],
	uv: number[],
	cols: number,
	hidden: boolean[],
	cuts: readonly number[] = [],
) {
	const rows = pos.length / 3 / cols;
	const idx: number[] = [];
	for (let r = 0; r < rows - 1; r++) {
		if ((hidden[r] && hidden[r + 1]) || cuts.includes(r)) continue;
		for (let c = 0; c < cols - 1; c++) {
			const a = r * cols + c;
			idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols); // columns run left → right: counter-clockwise from above
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setIndex(idx);
	return g;
}

/** The road's paint, metres: each line's half width, the centre dash and its period. */
const EDGE_HALF = 0.06;
const CENTRE_HALF = 0.055;
const DASH_M = 3;
const DASH_EVERY_M = 12;
/** The edge line across the mouth of a joining road: a dash and a gap in this many metres. */
const MOUTH_EVERY_M = 2;
/** And how near the joining road's centre line an edge line is dashed: nearer than the far edge line ever is, 0.35 m short of the asphalt's half width. */
const MOUTH_WITHIN_M = ROAD_W / 2 - 0.6;

/**
 * The road as paint on the ribbon (#3674, ADR-0092): flat asphalt, flat
 * off-white lines, a gravel shoulder outside each edge line, then the verge.
 * Lit by the sky like everything else, never glowing (ADR-0072). Every edge
 * is box-filtered over one pixel with fwidth. A line never draws narrower
 * than a pixel: where it would, it draws a pixel wide at the share of the
 * pixel it covers, so it fades with distance instead of shimmering, and the
 * centre's dashes fade into their average once they are too short to draw.
 */
export function roadMaterial(
	c: Style['road'],
	lights: Lights = lightsUniforms(),
	/** Where a designed road's snow lies from (designed.ts), as a height in the scene: above it the shoulder and the verge are snow, a bank ploughed up beside the asphalt. */
	snow?: { y: number; color: string },
	/** A gravel lane's (designed.ts Lane): GRAVEL_W of the shoulder's gravel, no line on it, a grass edge, then the verge. */
	gravel = false,
): THREE.MeshLambertMaterial {
	const m = new THREE.MeshLambertMaterial();
	/** Half the surface's width: the edge of the asphalt, or of the gravel. */
	const half = (gravel ? GRAVEL_W : ROAD_W) / 2;
	const edgeAt = gravel ? half : ROAD_W / 2 + 0.9;
	m.onBeforeCompile = (s) => {
		Object.assign(s.uniforms, lights);
		s.uniforms.uSnowY = { value: snow?.y ?? 1e9 };
		s.uniforms.uSnow = { value: new THREE.Color(snow?.color ?? '#fff') };
		s.uniforms.uAsphalt = {
			value: new THREE.Color(gravel ? (c.shoulder ?? c.verge) : c.asphalt),
		};
		s.uniforms.uLine = { value: new THREE.Color(c.line) };
		s.uniforms.uVerge = { value: new THREE.Color(c.verge) };
		s.uniforms.uShoulder = {
			value: new THREE.Color(gravel ? c.verge : (c.shoulder ?? c.verge)),
		};
		s.vertexShader = s.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nattribute vec2 bare;\nvarying vec2 vBare;\nvarying vec2 vRoad;\nvarying vec3 vLampAt;',
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				vRoad = uv;
				vBare = bare;
				vec4 lampAt = vec4(transformed, 1.0);
				#ifdef USE_BATCHING
					lampAt = batchingMatrix * lampAt;
				#endif
				vLampAt = (modelMatrix * lampAt).xyz;`,
			);
		s.fragmentShader = s.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				varying vec2 vRoad;
				varying vec2 vBare;
				varying vec3 vLampAt;
				${POOL}
				uniform vec3 uAsphalt; uniform vec3 uLine; uniform vec3 uVerge; uniform vec3 uShoulder;
				uniform float uSnowY; uniform vec3 uSnow;
				// A stripe of half width h at distance d, one pixel fw wide at least, at the share of it the stripe covers.
				float paint(float d, float h, float fw) {
					float w = max(h, 0.5 * fw);
					return (1.0 - smoothstep(w - 0.5 * fw, w + 0.5 * fw, d)) * h / w;
				}`,
			)
			.replace(
				'vec4 diffuseColor = vec4( diffuse, opacity );',
				`float u = vRoad.x, s = vRoad.y;
				float fw = max(fwidth(u), 1e-4);
				float fs = max(fwidth(s), 1e-4);
				float edge = paint(abs(abs(u) - ${(ROAD_W / 2 - 0.25).toFixed(2)}), ${EDGE_HALF.toFixed(3)}, fw);
				float along = abs(mod(s - ${(DASH_M / 2).toFixed(1)} + ${(DASH_EVERY_M / 2).toFixed(1)}, ${DASH_EVERY_M.toFixed(1)}) - ${(DASH_EVERY_M / 2).toFixed(1)});
				float dash = mix(paint(along, ${(DASH_M / 2).toFixed(1)}, fs), ${(DASH_M / DASH_EVERY_M).toFixed(2)}, smoothstep(0.15, 0.5, fs / ${DASH_EVERY_M.toFixed(1)}));
				float centre = paint(abs(u), ${CENTRE_HALF.toFixed(3)}, fw) * dash;
				${gravel ? 'edge = 0.0; centre = 0.0; // gravel: no paint' : ''}
				float shoulder = smoothstep(${half.toFixed(2)} - 0.5 * fw, ${half.toFixed(2)} + 0.5 * fw, abs(u));
				float verge = smoothstep(${edgeAt.toFixed(2)} - 0.5 * fw, ${edgeAt.toFixed(2)} + 0.5 * fw, abs(u));
				// Where it meets another pass (crossings.ts): o metres off that pass's centre line, and which of the two it is.
				float o = abs(vBare.x);
				float fo = max(fwidth(o), 1e-4);
				float joins = step(0.5, vBare.y);
				float joined = step(0.5, -vBare.y);
				// A side road at a junction (crossings.ts SEATED): its distance signed, negative past the line of the road it meets.
				float seated = step(1.5, vBare.y);
				// A pass joining an earlier one is not drawn inside its asphalt, but for a hand's width at its edge: o is read off a line of 10 m chords, and where each ribbon stopped exactly at the other the ground showed between them. A side road is not drawn past that road's line either.
				if (joins > 0.5 && mix(o, vBare.x, seated) < ${(ROAD_W / 2 - 0.1).toFixed(2)}) discard;
				// Nor is its shoulder or verge drawn on the earlier one's formation: where it comes in along that road, a roundabout's arm, its shoulder lay across that road's far edge. A side road seated on the road it meets keeps its shoulder there: the two shoulders meet where the higher lies, round the corner as one.
				if (joins > 0.5 && seated < 0.5 && abs(u) > ${half.toFixed(2)} && o < ${FORMATION.toFixed(2)}) discard;
				// And the pass joined draws no shoulder under the joining one's asphalt: two surfaces there, each lit by its own slope, drew as streaks.
				if (joined > 0.5 && abs(u) > ${half.toFixed(2)} && o < ${(ROAD_W / 2 - 0.15).toFixed(2)}) discard;
				float theirs = 1.0 - smoothstep(${(ROAD_W / 2).toFixed(2)} - 0.5 * fo, ${(ROAD_W / 2).toFixed(2)} + 0.5 * fo, o);
				float theirEdge = 1.0 - smoothstep(${(ROAD_W / 2 + 0.9).toFixed(2)} - 0.5 * fo, ${(ROAD_W / 2 + 0.9).toFixed(2)} + 0.5 * fo, o);
				// Across the mouth of a road joining it, the pass joined dashes its edge line, a metre on and a metre off: the line runs on, and the road beside it is seen to be another.
				float mouthAt = abs(mod(s, ${MOUTH_EVERY_M.toFixed(1)}) - ${(MOUTH_EVERY_M / 2).toFixed(1)});
				float mouthDash = mix(paint(mouthAt, ${(MOUTH_EVERY_M / 4).toFixed(2)}, fs), 0.5, smoothstep(0.15, 0.5, fs / ${MOUTH_EVERY_M.toFixed(1)}));
				// Only the edge the other road lies beyond: its centre line is ${MOUTH_WITHIN_M.toFixed(1)} m from my edge line at the most, and from my far edge never.
				float mouth = 1.0 - smoothstep(${MOUTH_WITHIN_M.toFixed(2)} - 0.5 * fo, ${MOUTH_WITHIN_M.toFixed(2)} + 0.5 * fo, o);
				edge *= mix(1.0, mouthDash, joined * mouth);
				// Its formation takes my lines and its shoulder my verge, its asphalt everything; the pass joined keeps its paint, and gives only its shoulder.
				float line = max(edge, centre) * (1.0 - theirEdge * (1.0 - joined));
				vec3 col = mix(uAsphalt, uShoulder, shoulder);
				col = mix(col, uLine, line * (1.0 - shoulder));
				// And no verge of mine on its formation: a green wedge on its shoulder at each corner of a junction.
				float theirForm = 1.0 - smoothstep(${FORMATION.toFixed(2)} - 0.5 * fo, ${FORMATION.toFixed(2)} + 0.5 * fo, o);
				col = mix(col, uVerge, verge * (1.0 - theirEdge));
				// At a junction the two shoulders meet where the higher lies, and each verge runs on to the other's: one L round the corner, nothing to recolour.
				float atMouth = step(1.5, abs(vBare.y));
				col = mix(col, uShoulder, verge * theirForm * (1.0 - theirEdge) * (1.0 - atMouth));
				col = mix(col, uSnow, shoulder * smoothstep(uSnowY - ${SNOW_EASE_M.toFixed(1)}, uSnowY + ${SNOW_EASE_M.toFixed(1)}, vLampAt.y));
				col = mix(col, uAsphalt, theirs * mix(1.0, shoulder, joined));
				vec4 diffuseColor = vec4(col, opacity);`,
			)
			.replace(
				'#include <opaque_fragment>',
				`float pool = lampPool(vLampAt); // a third of the way to amber, the lounge's pool
				outgoingLight = mix(outgoingLight, uAmber, pool / 3.0);
				#include <opaque_fragment>`,
			)
			.replace(
				'#include <dithering_fragment>',
				`#include <dithering_fragment>
				#ifdef PIXEL_RAMP
					if (uDiorama > 0.5) gl_FragColor.a = 0.5; // the land, for the ink pass (diorama.ts)
				#endif`,
			);
	};
	m.customProgramCacheKey = () =>
		`road-${c.asphalt}-${c.line}-${c.verge}-${c.shoulder}-${snow?.y}-${snow?.color}-${gravel}`;
	return m;
}

// The world's edge as a plinth: walls from the ground's outline down to a
// flat base, so the route reads as a model on a table instead of a world
// that stops.
export function plinth(
	route: Route,
	w: World,
	depth = 220,
): THREE.BufferGeometry {
	const base = yOf(route, route.minEle) - depth;
	const pos: number[] = [];
	for (let k = 0; k < w.rim.length; k += 6) {
		const [ax, ay, az, bx, by, bz] = w.rim.slice(k, k + 6);
		const [ya, yb] = [yOf(route, ay), yOf(route, by)];
		pos.push(ax, ya, az, ax, base, az, bx, yb, bz);
		pos.push(bx, yb, bz, ax, base, az, bx, base, bz);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute(
		'position',
		new THREE.BufferAttribute(new Float32Array(pos), 3),
	);
	g.computeVertexNormals();
	return g;
}
