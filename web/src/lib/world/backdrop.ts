// The horizon: three silhouette rings of mountains beyond the world's edge,
// with a hero peak at the bearing the chase camera faces for the most riding
// time and a second one at least 60° away. The world stops; the view doesn't.
// The ranges are sized by the angle they stand at, not in metres, so on any
// route the far ones stay low, as distant mountains do, and the sky's band
// lies level just over them; it reads how high they stand from the eye.
import * as THREE from 'three';
import { EXAG, yOf } from './geometry';
import { referenceSpeed } from '$lib/road/pace';
import { noise2, prng } from './rand';
import type { Route } from '$lib/road/route';

const smoothstep = THREE.MathUtils.smoothstep;

export type Peaks = { hero: number; second: number; share: number }; // radians (heading convention), share of riding time

// Which way does the camera look, weighted by how long you ride that way?
export function bearings(route: Route): Peaks {
	const bins = new Float64Array(36);
	let total = 0;
	for (let i = 0; i < route.x.length - 1; i++) {
		const v = referenceSpeed(route.grade[i]);
		const dt = route.step / Math.max(1, v);
		// atan2 answers in (−π, π] and the bins sit in [0, 2π): one range, or a
		// westward heading is counted toward bins up to 80° away.
		let h = Math.atan2(
			route.x[i + 1] - route.x[i],
			route.z[i + 1] - route.z[i],
		);
		if (h < 0) h += Math.PI * 2;
		for (let b = 0; b < 36; b++) {
			let d = Math.abs(h - (b * Math.PI) / 18);
			d = Math.min(d, Math.PI * 2 - d);
			if (d <= (34 * Math.PI) / 180) bins[b] += dt;
		}
		total += dt;
	}
	let b1 = 0;
	for (let b = 1; b < 36; b++) if (bins[b] > bins[b1]) b1 = b;
	let b2 = -1;
	for (let b = 0; b < 36; b++) {
		const gap = Math.min(Math.abs(b - b1), 36 - Math.abs(b - b1));
		if (gap >= 6 && (b2 < 0 || bins[b] > bins[b2])) b2 = b;
	}
	return {
		hero: (b1 * Math.PI) / 18,
		second: (b2 * Math.PI) / 18,
		share: bins[b1] / total,
	};
}

// Heights as the tangent of the angle each ring stands at from the world's
// middle, above the road's middle height: a ring is lower than the one
// behind it, and the farthest crest stands about 5° up: over the world's own
// hills, low as world-kom's distant ranges.
const RINGS = [
	{ R: 3000, fog: 0.35, lift: 0.035, amp: 0.02, hero: 0.7 },
	{ R: 8000, fog: 0.5, lift: 0.055, amp: 0.025, hero: 1.0 },
	{ R: 14000, fog: 0.65, lift: 0.07, amp: 0.03, hero: 0.35 }, // never the sky's own colour: the farthest still stands out from it
];
const SEG = 256;
const SKY_N = 256; // bearings the skyline is drawn at
const SKY_MOVE = 25; // metres the eye moves before it is drawn again
const SKY_WIDE = 24; // bearings each way (34°) a crest holds the band up: level across a view, never round each peak
const SKY_EASE = 12; // bearings each way that is then eased over
const SKY_SCALE = 4; // a byte's 0–1 is a sine of 0–0.25, about 14.5°: far over any range

/**
 * How high the far ranges stand from an eye, by bearing from +z clockwise:
 * the sine of the highest crest within SKY_WIDE bearings, eased, times
 * SKY_SCALE. Linear and wrapping, so the sky reads it by bearing.
 */
export type Skyline = {
	texture: THREE.DataTexture;
	/** Draws it from where the eye now is, once it has moved far enough to matter. */
	from(eye: THREE.Vector3): void;
};

export function backdrop(
	route: Route,
	seed: number,
	radius: number,
	colors: { ridge: string; rock: string; snow: string; fog: string },
	snow: boolean,
): { geometry: THREE.BufferGeometry; skyline: Skyline } {
	const peaks = bearings(route);
	const n = noise2(seed ^ 0x51f15e);
	const phase = prng(seed ^ 0x77)() * 100;
	const fog = new THREE.Color(colors.fog);
	const ridge = new THREE.Color(colors.ridge);
	const rock = new THREE.Color(colors.rock);
	const snowC = new THREE.Color(colors.snow);
	const pos: number[] = [];
	const col: number[] = [];
	const base = yOf(route, route.minEle) - 300;
	const mid = yOf(route, (route.minEle + route.maxEle) / 2) - base;
	const rings: { R: number; tops: number[] }[] = [];
	const snowline = (2400 - route.minEle) * EXAG;
	const near = (a: number, c: number, w: number) => {
		let d = Math.abs(a - c);
		d = Math.min(d, Math.PI * 2 - d);
		return Math.exp(-(d * d) / (2 * w * w));
	};
	RINGS.forEach((ring, k) => {
		const R = radius + ring.R;
		const tops: number[] = [];
		for (let s = 0; s <= SEG; s++) {
			const a = (s / SEG) * Math.PI * 2;
			const ridgeNoise =
				n(Math.cos(a) * 3 + phase + k * 17, Math.sin(a) * 3) * 0.6 +
				n(Math.cos(a) * 9 + k, Math.sin(a) * 9 + phase) * 0.25;
			const t =
				ring.lift +
				ring.amp * (0.45 + ridgeNoise) +
				(k === 0 ? 0.015 : 0.02) * ring.hero * near(a, peaks.hero, 0.07) +
				0.02 * (k === 1 ? 1 : 0.4) * near(a, peaks.second, 0.12);
			tops.push(mid + Math.max(0.004, t) * R);
		}
		rings.push({ R, tops });
		const p = (a: number, y: number) => [
			Math.sin(a) * R,
			base + y,
			Math.cos(a) * R,
		]; // heading convention: 0 = +z
		// Blended over a height band, not switched at a line: a switch inside
		// one quad draws a vertical seam wherever a ridge crosses the line.
		const c = (y: number) => {
			const out = ridge.clone();
			out.lerp(rock, smoothstep(y, snowline * 0.5, snowline * 0.74));
			if (snow) out.lerp(snowC, smoothstep(y, snowline * 0.8, snowline * 1.2));
			out.lerp(fog, ring.fog);
			return [out.r, out.g, out.b];
		};
		// two bands per segment: flank (ridge colour) and crown (rock, or snow above the snowline)
		const band = (
			a0: number,
			a1: number,
			y0a: number,
			y0b: number,
			y1a: number,
			y1b: number,
			colours: [number[], number[], number[], number[]],
		) => {
			const [ca, cb, ta, tb] = colours;
			[
				p(a0, y0a),
				p(a1, y0b),
				p(a0, y1a),
				p(a1, y0b),
				p(a1, y1b),
				p(a0, y1a),
			].forEach((q) => pos.push(...q));
			[ca, cb, ta, cb, tb, ta].forEach((q) => col.push(...q));
		};
		for (let s = 0; s < SEG; s++) {
			const a0 = (s / SEG) * Math.PI * 2;
			const a1 = ((s + 1) / SEG) * Math.PI * 2;
			const m0 = tops[s] * 0.72;
			const m1 = tops[s + 1] * 0.72;
			band(a0, a1, 0, 0, m0, m1, [c(0), c(0), c(0), c(0)]);
			band(a0, a1, m0, m1, tops[s], tops[s + 1], [
				c(m0),
				c(m1),
				c(tops[s]),
				c(tops[s + 1]),
			]);
		}
	});
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	// The near ring stands before the horizon; the far two make it.
	return { geometry: g, skyline: skylineOf(rings.slice(1), base) };
}

function skylineOf(
	rings: { R: number; tops: number[] }[],
	base: number,
): Skyline {
	const data = new Uint8Array(SKY_N);
	const raw = new Float64Array(SKY_N);
	const wide = new Float64Array(SKY_N);
	const texture = new THREE.DataTexture(data, SKY_N, 1, THREE.RedFormat);
	texture.wrapS = THREE.RepeatWrapping;
	texture.magFilter = texture.minFilter = THREE.LinearFilter;
	const at = (i: number) => (i + SKY_N) % SKY_N;
	let atX = Infinity;
	let atZ = Infinity;
	return {
		texture,
		from(eye) {
			if (Math.hypot(eye.x - atX, eye.z - atZ) < SKY_MOVE) return;
			atX = eye.x;
			atZ = eye.z;
			const ee = eye.x * eye.x + eye.z * eye.z;
			for (let i = 0; i < SKY_N; i++) {
				const a = (i / SKY_N) * Math.PI * 2;
				const dx = Math.sin(a);
				const dz = Math.cos(a);
				const ed = eye.x * dx + eye.z * dz;
				raw[i] = 0;
				for (const { R, tops } of rings) {
					// Where this bearing meets the ring, and how high the ridge stands there.
					const t = -ed + Math.sqrt(Math.max(0, ed * ed - ee + R * R));
					const u = Math.atan2(eye.x + t * dx, eye.z + t * dz) / (Math.PI * 2);
					const f = (u - Math.floor(u)) * SEG;
					const s = Math.min(SEG - 1, Math.floor(f));
					const up = base + tops[s] + (tops[s + 1] - tops[s]) * (f - s) - eye.y;
					raw[i] = Math.max(raw[i], up / Math.hypot(t, up));
				}
			}
			for (let i = 0; i < SKY_N; i++) {
				wide[i] = 0;
				for (let j = -SKY_WIDE; j <= SKY_WIDE; j++)
					wide[i] = Math.max(wide[i], raw[at(i + j)]);
			}
			for (let i = 0; i < SKY_N; i++) {
				let sum = 0;
				for (let j = -SKY_EASE; j <= SKY_EASE; j++) sum += wide[at(i + j)];
				const top = sum / (2 * SKY_EASE + 1);
				data[i] = Math.round(Math.min(1, Math.max(0, top * SKY_SCALE)) * 255);
			}
			texture.needsUpdate = true;
		},
	};
}
