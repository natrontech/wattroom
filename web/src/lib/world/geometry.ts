// World → three.js buffers. Pure data in, geometry out; the scene decides
// materials, so one world can be drawn in any art style.
import * as THREE from 'three';
import { Biome } from './biome';
import type { RoutePoint } from '#lib/road/along.ts';
import { type Route } from '#lib/road/route.ts';
import { lightsUniforms, POOL, type Lights } from './lights';
import type { Palette, Style } from './styles';
import type { TerrainMesh } from './terrain-mesh';
import type { World } from './world';
import { sharedAt } from './shared-road';
import { BANK_SPAN_M, banksOf, bendsOf } from './terrain/road-frame';
import { ribbonRows, ROAD_W, SHOULDER_DROP } from './terrain/road-profile';

export const EXAG = 1.2; // vertical exaggeration; the Alps read flat from a chase cam otherwise
export { ROAD_W } from './terrain/road-profile';
export const ROAD_LIFT = 0.12;

export const yOf = (route: Route, ele: number) => (ele - route.minEle) * EXAG;

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
	const cache = new Map<number, THREE.Color>();
	for (const [k, v] of Object.entries(palette))
		cache.set(Number(k), new THREE.Color(v));
	const meadow = cache.get(Biome.Meadow) ?? new THREE.Color();
	const wood = cache.get(Biome.Forest) ?? meadow;
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
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(p, 3));
	g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
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
	for (let r = first; r <= last; r++) {
		const p = centre[r - first];
		const d = rows.metre(r);
		const k = bends[r - first]; // curvature, +left
		// A later pass easing onto an earlier one sinks under it, and is not drawn where it is on it (#4531).
		const w = sharedAt(route, d);
		// Its bend onto the earlier one is no road's bend: unbanked as it lands, so it never tilts up through the earlier one.
		const bank = banks[r - first] * (1 - w);
		const lx = Math.cos(p.heading); // left of travel
		const lz = -Math.sin(p.heading);
		sides.push(new THREE.Vector3(lx, -Math.tan(bank), lz)); // across the asphalt, leftward
		hidden.push(w >= 1);
		const y = yOf(route, p.ele) + lift - SHARED_SINK * w;
		const tx = Math.sin(p.heading);
		const tz = Math.cos(p.heading);
		for (let c = 0; c < cols; c++) {
			let u = offs[c];
			if (Math.sign(u) === Math.sign(k) && Math.abs(k) > 1e-4)
				u = Math.sign(u) * Math.min(Math.abs(u), 0.85 / Math.abs(k));
			const v = new THREE.Vector3(
				p.x + lx * u,
				y + drops[c] - u * Math.tan(bank),
				p.z + lz * u,
			);
			// walk the column: never step backwards along the road (a degenerate triangle, not a bow-tie)
			const q = prev[c];
			if (q && (v.x - q.x) * tx + (v.z - q.z) * tz <= 0) v.copy(q);
			prev[c] = v;
			pos.push(v.x, v.y, v.z);
			uv.push(offs[c], d);
		}
	}
	const whole = strip(pos, uv, cols, hidden);
	whole.setAttribute(
		'normal',
		new THREE.Float32BufferAttribute(normals(pos, sides, cols), 3),
	);
	// The rows asked for, lit as the whole ribbon lights them.
	const lo = Math.max(from, first);
	const hi = Math.min(top, last);
	if (lo === first && hi === last) {
		whole.computeBoundingSphere();
		return whole;
	}
	const keep = (a: THREE.BufferAttribute) =>
		Array.from(
			a.array.slice(
				(lo - first) * cols * a.itemSize,
				(hi - first + 1) * cols * a.itemSize,
			),
		);
	const piece = strip(
		keep(whole.attributes.position as THREE.BufferAttribute),
		keep(whole.attributes.uv as THREE.BufferAttribute),
		cols,
		hidden.slice(lo - first, hi - first + 1),
	);
	piece.setAttribute(
		'normal',
		new THREE.Float32BufferAttribute(
			keep(whole.attributes.normal as THREE.BufferAttribute),
			3,
		),
	);
	whole.dispose();
	piece.computeBoundingSphere();
	return piece;
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

/** Quads between rows; none between two `hidden` rows. */
function strip(pos: number[], uv: number[], cols: number, hidden: boolean[]) {
	const rows = pos.length / 3 / cols;
	const idx: number[] = [];
	for (let r = 0; r < rows - 1; r++) {
		if (hidden[r] && hidden[r + 1]) continue;
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
): THREE.MeshLambertMaterial {
	const m = new THREE.MeshLambertMaterial();
	m.onBeforeCompile = (s) => {
		Object.assign(s.uniforms, lights);
		s.uniforms.uAsphalt = { value: new THREE.Color(c.asphalt) };
		s.uniforms.uLine = { value: new THREE.Color(c.line) };
		s.uniforms.uVerge = { value: new THREE.Color(c.verge) };
		s.uniforms.uShoulder = { value: new THREE.Color(c.shoulder ?? c.verge) };
		s.vertexShader = s.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nvarying vec2 vRoad;\nvarying vec3 vLampAt;',
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				vRoad = uv;
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
				varying vec3 vLampAt;
				${POOL}
				uniform vec3 uAsphalt; uniform vec3 uLine; uniform vec3 uVerge; uniform vec3 uShoulder;
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
				float shoulder = smoothstep(${(ROAD_W / 2).toFixed(2)} - 0.5 * fw, ${(ROAD_W / 2).toFixed(2)} + 0.5 * fw, abs(u));
				float verge = smoothstep(${(ROAD_W / 2 + 0.9).toFixed(2)} - 0.5 * fw, ${(ROAD_W / 2 + 0.9).toFixed(2)} + 0.5 * fw, abs(u));
				float line = max(edge, centre);
				vec3 col = mix(uAsphalt, uShoulder, shoulder);
				col = mix(col, uLine, line * (1.0 - shoulder));
				col = mix(col, uVerge, verge);
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
		`road-${c.asphalt}-${c.line}-${c.verge}-${c.shoulder}`;
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
