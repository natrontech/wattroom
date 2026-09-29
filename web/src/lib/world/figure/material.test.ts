import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Style } from '../styles';
import { WHEELS, resolveKit } from './kit';
import {
	COVERAGE_GLSL,
	FIGURE_LIGHT,
	TOON_BANDS,
	blurWindow,
	figureLight,
	figureMaterial,
	lightFigures,
	spokeCoverage,
} from './material';

const FPS = 30; // docs/SPEC.md "The world": 30 fps on a vsync divisor
/** #3073: above 0.35 of a period a frame, the pattern goes uniform — the issue's number, not the module's. */
const GONE = 0.35;
const TAU = 2 * Math.PI;
const phis = Array.from({ length: 720 }, (_, i) => (i / 720) * TAU);

/** How much of a pattern shows in one frame: the spread of its coverage around the wheel. A pixel always has a footprint, h. */
function contrast(delta: number, k: number, w: number, h: number): number {
	const c = phis.map((phi) => spokeCoverage(phi, delta, k, w, h));
	return Math.max(...c) - Math.min(...c);
}
const fine = Array.from({ length: 20000 }, (_, i) => (i / 20000) * TAU);
const mean = (delta: number, k: number, w: number) =>
	fine.reduce((s, phi) => s + spokeCoverage(phi, delta, k, w, 0.001), 0) /
	fine.length;

// Every pattern the kits draw: spokes at the hub and at the rim, blades, and the rim decals and their letters.
const patterns = Object.values(WHEELS).flatMap((wh) =>
	[wh.front, wh.rear].flatMap((s) => {
		const own =
			s.type === 'spoked'
				? [0.06, 0.28].map((r) => ({ k: s.spokes, w: 0.0022 / r }))
				: s.type === 'blades'
					? [{ k: s.blades, w: s.bladeMm / 1000 / 0.15 }]
					: [];
		const arc = (wh.decal.arcDeg * Math.PI) / 180;
		const decal = wh.decal.count
			? [
					{ k: wh.decal.count, w: arc },
					{ k: TAU / (arc / 6), w: (arc / 6) * 0.6 },
				]
			: [];
		return [...own, ...decal];
	}),
);

describe('wheels that never strobe (G13)', () => {
	it('shows a pattern only while it moves less than 0.35 of its period a frame, 0–100 km/h at 30 fps', () => {
		let worst = 0;
		for (const R of [0.31, 0.35])
			for (let kmh = 0; kmh <= 100; kmh += 0.5)
				for (const { k, w } of patterns)
					for (const h of [0, 0.004]) {
						const delta = kmh / 3.6 / R / FPS;
						if (delta + 2 * h < GONE * (TAU / k)) continue;
						worst = Math.max(worst, contrast(delta, k, w, h));
					}
		expect(worst).toBeLessThan(0.02);
	});

	it('draws the spokes crisp at rest, and never moves the brightness as the wheel speeds up', () => {
		const k = 24;
		const w = 0.0022 / 0.2;
		expect(contrast(0, k, w, 0.001)).toBeGreaterThan(0.99);
		for (let kmh = 0; kmh <= 100; kmh += 1)
			expect(mean(kmh / 3.6 / 0.34 / FPS, k, w)).toBeCloseTo((w * k) / TAU, 3);
	});
});

describe('the shader and its JS mirror (G13b)', () => {
	// The shader's own coverage functions, run as JS: GLSL's float functions read as JS once typed away.
	const js = COVERAGE_GLSL.replace(
		/float (\w+)\(([^)]*)\)\s*\{/g,
		(_, name: string, args: string) =>
			`function ${name}(${args.replace(/float /g, '')}) {`,
	).replace(/\bfloat (\w+) =/g, 'let $1 =');
	const clamp = (x: number, a: number, b: number) =>
		Math.min(Math.max(x, a), b);
	const glsl = new Function(
		'floor',
		'min',
		'max',
		'mod',
		'clamp',
		'mix',
		'smoothstep',
		'ceil',
		`${js}\nreturn { sweepCover, blurWin };`,
	)(
		Math.floor,
		Math.min,
		Math.max,
		(x: number, y: number) => x - y * Math.floor(x / y),
		clamp,
		(a: number, b: number, t: number) => a + (b - a) * t,
		(e0: number, e1: number, x: number) => {
			const t = clamp((x - e0) / (e1 - e0), 0, 1);
			return t * t * (3 - 2 * t);
		},
		Math.ceil,
	) as {
		sweepCover: (
			phi: number,
			win: number,
			h: number,
			P: number,
			w: number,
		) => number;
		blurWin: (d: number, P: number) => number;
	};

	it('computes the same window and the same coverage for any sweep', () => {
		let seed = 1;
		const rnd = () =>
			(seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
		for (let i = 0; i < 5000; i++) {
			const k = [2, 3, 20, 24, 36][i % 5];
			const P = TAU / k;
			const d = rnd() * 2 * P;
			const phi = rnd() * TAU;
			const w = rnd() * P;
			const h = rnd() * 0.01;
			expect(glsl.blurWin(d, P)).toBeCloseTo(blurWindow(d, P), 9);
			expect(
				glsl.sweepCover(phi, glsl.blurWin(d + 2 * h, P), h, P, w),
			).toBeCloseTo(spokeCoverage(phi, d, k, w, h), 6);
		}
	});
});

describe('the toon figure material', () => {
	const m = figureMaterial(resolveKit(), new THREE.Color(1, 1, 1));

	it('shades in three bands with no emissive term, and draws coverage as alpha-to-coverage', () => {
		const img = (m.gradientMap as THREE.DataTexture).image;
		expect([...img.data!].filter((_, i) => i % 4 === 0)).toEqual([
			...TOON_BANDS,
		]);
		expect(m.gradientMap!.magFilter).toBe(THREE.NearestFilter);
		expect(m.emissive.getHex()).toBe(0);
		expect(m.alphaToCoverage).toBe(true);
	});

	it('keeps the rim at ×0.3–0.4 of the sunward sky and the fresnel at ×0.1–0.14 of the sky above', () => {
		expect(FIGURE_LIGHT.rim).toBeGreaterThanOrEqual(0.3);
		expect(FIGURE_LIGHT.rim).toBeLessThanOrEqual(0.4);
		expect(FIGURE_LIGHT.sky).toBeGreaterThanOrEqual(0.1);
		expect(FIGURE_LIGHT.sky).toBeLessThanOrEqual(0.14);
		// A fixture look: the tones come from the world's style, never from the material.
		const style = {
			sky: { top: '#203060', horizon: '#000000', sunward: '#f0a080' },
			sun: { elevation: -6, azimuth: 120 },
		} as Style;
		const cam = new THREE.PerspectiveCamera();
		cam.updateMatrixWorld();
		lightFigures(style, cam);
		expect(figureLight.uRimSun.value.r).toBeCloseTo(
			new THREE.Color('#f0a080').r * FIGURE_LIGHT.rim,
			6,
		);
		expect(figureLight.uRimSky.value.b).toBeCloseTo(
			new THREE.Color('#203060').b * FIGURE_LIGHT.sky,
			6,
		);
		expect(figureLight.uSunV.value.length()).toBeCloseTo(1, 6);
	});

	it('patches the toon shader where it means to, on this three.js', () => {
		const sh = {
			uniforms: {} as Record<string, unknown>,
			vertexShader: THREE.ShaderLib.toon.vertexShader,
			fragmentShader: THREE.ShaderLib.toon.fragmentShader,
		};
		m.onBeforeCompile(
			sh as unknown as THREE.WebGLProgramParametersWithUniforms,
			{} as THREE.WebGLRenderer,
		);
		expect(sh.vertexShader).toContain('vAux = aux;');
		expect(sh.fragmentShader).toContain('float blurWin(');
		expect(sh.fragmentShader).toContain('diffuseColor.a = cov;');
		expect(sh.fragmentShader).toContain('uRimSun * clamp(dot(normal, uSunV)');
		expect(Object.keys(sh.uniforms)).toEqual(
			expect.arrayContaining([
				'uWheelDelta',
				'uDecalStyle',
				'uDecal',
				'uSunV',
				'uRimSun',
				'uRimSky',
			]),
		);
	});

	it('blurs each rider’s wheels over its own sweep', () => {
		const obj = new THREE.Object3D();
		obj.userData.wheelDelta = 0.8;
		m.onBeforeRender(
			{} as THREE.WebGLRenderer,
			new THREE.Scene(),
			new THREE.Camera(),
			new THREE.BufferGeometry(),
			obj,
			new THREE.Group(),
		);
		expect(m.userData.u.uWheelDelta.value).toBe(0.8);
	});
});
