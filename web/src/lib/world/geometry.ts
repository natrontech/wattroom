// World → three.js buffers. Pure data in, geometry out; the scene decides
// materials, so one world can be drawn in any art style.
import * as THREE from 'three';
import { Biome } from './biome';
import { type Route } from '$lib/road/route';
import type { Palette, Style } from './styles';
import type { World } from './world';
import { bendsOf } from './terrain/road-frame';
import {
	bankOf,
	drawnRows,
	ROAD_W,
	SHOULDER_DROP,
} from './terrain/road-profile';

export const EXAG = 1.2; // vertical exaggeration; the Alps read flat from a chase cam otherwise
export { ROAD_W } from './terrain/road-profile';
const ROAD_LIFT = 0.12;

export const yOf = (route: Route, ele: number) => (ele - route.minEle) * EXAG;

export function terrain(
	route: Route,
	w: World,
	palette: Palette,
): THREE.BufferGeometry {
	const { pos, biome, shade, forest, index } = w.mesh;
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
// edge, centre, edge, shoulder. Banked into bends (≤ 4°) by the curvature road
// furniture stands on (bendsOf), inside columns clamped to 0.85 × the bend
// radius so a hairpin never folds into a bow-tie.
// uv carries (metres across, metres along) for the marking shader.
export function road(
	route: Route,
	opts: {
		width?: number;
		lift?: number;
		shoulder?: number;
		step?: number;
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
	const pos: number[] = [];
	const uv: number[] = [];
	const prev: THREE.Vector3[] = [];
	const centre = drawnRows(route, step);
	const bends = bendsOf(
		centre.map((p) => p.x),
		centre.map((p) => p.z),
	);
	for (let r = 0; r < centre.length; r++) {
		const p = centre[r];
		const d = r * step;
		const k = bends[r]; // curvature, +left
		const bank = bankOf(k);
		const lx = Math.cos(p.heading); // left of travel
		const lz = -Math.sin(p.heading);
		const y = yOf(route, p.ele) + lift;
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
	const rows = pos.length / 3 / cols;
	const idx: number[] = [];
	for (let r = 0; r < rows - 1; r++)
		for (let c = 0; c < cols - 1; c++) {
			const a = r * cols + c;
			idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols); // columns run left → right: counter-clockwise from above
		}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setIndex(idx);
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}

// Road surface with markings drawn in the fragment shader: edge lines, a
// 3-on-9-off centre dash, verge beyond the edge — box-filtered with fwidth,
// so they stay crisp at 2 m and never shimmer at 2 km.
export function roadMaterial(c: Style['road']): THREE.MeshLambertMaterial {
	const m = new THREE.MeshLambertMaterial();
	m.onBeforeCompile = (s) => {
		s.uniforms.uAsphalt = { value: new THREE.Color(c.asphalt) };
		s.uniforms.uLine = { value: new THREE.Color(c.line) };
		s.uniforms.uVerge = { value: new THREE.Color(c.verge) };
		s.vertexShader = s.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec2 vRoad;')
			.replace(
				'#include <begin_vertex>',
				'#include <begin_vertex>\nvRoad = uv;',
			);
		s.fragmentShader = s.fragmentShader
			.replace(
				'#include <common>',
				'#include <common>\nvarying vec2 vRoad;\nuniform vec3 uAsphalt; uniform vec3 uLine; uniform vec3 uVerge;',
			)
			.replace(
				'vec4 diffuseColor = vec4( diffuse, opacity );',
				`float u = vRoad.x, s = vRoad.y;
				float fw = max(fwidth(u), 1e-4);
				float edge = 1.0 - smoothstep(0.06 - fw, 0.06 + fw, abs(abs(u) - 2.95));
				float centre = (1.0 - smoothstep(0.055 - fw, 0.055 + fw, abs(u))) * step(fract(s / 12.0), 0.25);
				float verge = smoothstep(3.2 - fw, 3.2 + fw, abs(u));
				vec3 col = mix(uAsphalt, uLine, max(edge, centre));
				col = mix(col, uVerge, verge);
				vec4 diffuseColor = vec4(col, opacity);`,
			)
			// markings stay legible at dusk — flat, never bloomed
			.replace(
				'#include <emissivemap_fragment>',
				'#include <emissivemap_fragment>\ntotalEmissiveRadiance += uLine * max(edge, centre) * (1.0 - verge) * 0.45;',
			);
	};
	m.customProgramCacheKey = () => `road-${c.asphalt}-${c.line}-${c.verge}`;
	return m;
}

// Instanced props: one matrix per item; `sink` so nothing hovers on a slope.
export function instanced(
	route: Route,
	geometry: THREE.BufferGeometry,
	material: THREE.Material,
	data: Float32Array,
	stride: number,
	opts: {
		scale?: (i: number) => number;
		rot?: (i: number) => number;
		keep?: (i: number) => boolean;
		sink?: number;
	} = {},
): THREE.InstancedMesh {
	const total = Math.floor(data.length / stride);
	const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, total));
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const s = new THREE.Vector3();
	const p = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);
	let n = 0;
	for (let i = 0; i < total; i++) {
		if (opts.keep && !opts.keep(i)) continue;
		const o = i * stride;
		p.set(data[o], yOf(route, data[o + 1]) - (opts.sink ?? 0), data[o + 2]);
		q.setFromAxisAngle(up, opts.rot?.(i) ?? 0);
		s.setScalar(opts.scale?.(i) ?? 1);
		mesh.setMatrixAt(n++, m.compose(p, q, s));
	}
	mesh.count = n;
	mesh.instanceMatrix.needsUpdate = true;
	mesh.computeBoundingSphere();
	return mesh;
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
