import * as THREE from 'three';
import { ramp } from '../materials';
import { sunDir, type Style } from '../styles';
import type { Kit } from './kit';

/**
 * The figure's material (#3073): three toon bands, a rim of the sunward sky
 * and a sky fresnel, no emissive term (ADR-0072: only your own line glows).
 * Spokes, blades and rim decals are drawn on the wheel's discs by coverage:
 * a box filter over the frame's sweep plus the pixel's own footprint, which
 * goes to the pattern's uniform average once the sweep reaches 0.35 of a
 * period — at 30 fps a wheel turns 47° a frame at 30 km/h, and a sampled
 * pattern would strobe. Coverage becomes alpha, and alpha-to-coverage under
 * MSAA draws it with no sorting and one draw.
 */

/** Of a pattern's period: the sweep where the blur starts widening, and where the pattern is gone. */
export const BLUR = { start: 0.2, full: 0.35 } as const;
export const TOON_BANDS = [110, 185, 255] as const;
/** The rim, of the sunward sky, gated by the sun's side; and the fresnel, of the sky overhead. */
export const FIGURE_LIGHT = { rim: 0.35, sky: 0.12 } as const;
const DECAL_STYLES = ['none', 'logo', 'band', 'grooves'] as const;

/** The coverage functions, shared verbatim by the shader and (see material.test.ts) checked against the mirror below. */
export const COVERAGE_GLSL = /* glsl */ `
float covF(float x, float P, float w) { return floor(x / P) * w + min(mod(x, P), w); }
float sweepCover(float phi, float win, float h, float P, float w) {
	float b = phi + h; float a = b - win;
	return clamp((covF(b, P, w) - covF(a, P, w)) / max(win, 1e-5), 0.0, 1.0);
}
float blurWin(float d, float P) {
	if (d >= 0.35 * P) return P * max(1.0, ceil(d / P - 1e-4));
	return mix(d, P, smoothstep(0.2 * P, 0.35 * P, d));
}
`;

/** The shader's blurWin in JS: the window a pattern of period P is filtered over for a sweep d. */
export function blurWindow(d: number, P: number): number {
	if (d >= BLUR.full * P) return P * Math.max(1, Math.ceil(d / P - 1e-4));
	const t = Math.min(
		Math.max((d - BLUR.start * P) / ((BLUR.full - BLUR.start) * P), 0),
		1,
	);
	return d + (P - d) * t * t * (3 - 2 * t);
}

/** Coverage at angle phi of k features widthRad wide, swept delta this frame, h half a pixel's footprint. */
export function spokeCoverage(
	phi: number,
	delta: number,
	k: number,
	widthRad: number,
	h = 0,
): number {
	const P = (2 * Math.PI) / k;
	const w = Math.min(widthRad, P);
	const win = blurWindow(delta + 2 * h, P);
	// GLSL's mod, x − P·floor(x/P): JS's % rounds apart from floor at a period's edge and loses a whole spoke.
	const F = (x: number) => {
		const n = Math.floor(x / P);
		return n * w + Math.min(x - n * P, w);
	};
	return Math.min(
		Math.max((F(phi + h) - F(phi + h - win)) / Math.max(win, 1e-5), 0),
		1,
	);
}

const PARS = /* glsl */ `
flat varying vec3 vAux;
varying vec3 vPc;
uniform float uWheelDelta;
uniform float uDecalStyle;
uniform vec3 uDecal;
uniform vec3 uSunV;
uniform vec3 uRimSun;
uniform vec3 uRimSky;
${COVERAGE_GLSL}
float angFoot(float phi) { return min(fwidth(phi), fwidth(fract(phi / 6.2831853 + 0.5) * 6.2831853)); }
float aa(float edge, float x) { float w = max(fwidth(x), 1e-4) * 0.75; return smoothstep(edge - w, edge + w, x); }
float triw(float x) { return abs(fract(x) - 0.5) * 2.0; }
`;

// pattern spaces (contract.ts SP): 3 decal, 4 spokes, 5 blades
const WHEELS = /* glsl */ `#include <color_fragment>
{
	int sp = int(vAux.x + 0.5);
	if (sp >= 3) {
		float phi = atan(vPc.y, vPc.x); if (phi < 0.0) phi += 6.2831853;
		float r = length(vPc.xy); float h = 0.5 * angFoot(phi);
		if (sp == 3) {
			if (vAux.y > 0.5 && uDecalStyle > 0.5 && r > 0.19 && r < 0.309) {
				float P = 6.2831853 / vAux.y; float arc = vAux.z;
				float cov = sweepCover(phi, blurWin(uWheelDelta + 2.0 * h, P), h, P, arc);
				if (uDecalStyle < 1.5) { float lp = arc / 6.0; cov *= sweepCover(phi, blurWin(uWheelDelta + 2.0 * h, lp), h, lp, lp * 0.6); }
				if (uDecalStyle > 2.5) { cov = max(cov * 0.25, 0.4 * aa(0.6, triw(r * 700.0))); }
				diffuseColor.rgb = mix(diffuseColor.rgb, uDecal, cov);
			}
		} else {
			float k = vAux.y; float wm = vAux.z / 1000.0;
			if (sp == 5) wm *= 1.0 - 0.45 * clamp((r - 0.03) / 0.26, 0.0, 1.0);
			float P = 6.2831853 / k; float w = min(wm / max(r, 0.01), P);
			float cov = sweepCover(phi, blurWin(uWheelDelta + 2.0 * h, P), h, P, w);
			diffuseColor.a = cov;
			if (cov < 0.004) discard;
		}
	}
}`;

const LIGHT = /* glsl */ `{
	vec3 vd = normalize(vViewPosition);
	float fr = pow(1.0 - clamp(dot(vd, normal), 0.0, 1.0), 3.0);
	outgoingLight += fr * (uRimSun * clamp(dot(normal, uSunV) * 0.8 + 0.25, 0.0, 1.0) + uRimSky);
}
#include <opaque_fragment>`;

/** Scene-wide: every figure's rim and fresnel. `lightFigures` sets them from the world's look, each frame. */
export const figureLight = {
	uSunV: { value: new THREE.Vector3(0, 1, 0) },
	uRimSun: { value: new THREE.Color(0, 0, 0) },
	uRimSky: { value: new THREE.Color(0, 0, 0) },
};

/** The rim takes the sunward sky, the fresnel the sky overhead; the sun's direction is in view space. */
export function lightFigures(style: Style, camera: THREE.Camera): void {
	figureLight.uSunV.value
		.copy(sunDir(style))
		.transformDirection(camera.matrixWorldInverse);
	figureLight.uRimSun.value
		.set(style.sky.sunward)
		.multiplyScalar(FIGURE_LIGHT.rim);
	figureLight.uRimSky.value.set(style.sky.top).multiplyScalar(FIGURE_LIGHT.sky);
}

let bands: THREE.DataTexture | null = null;

export type FigureMaterial = THREE.MeshToonMaterial & {
	userData: {
		u: {
			uWheelDelta: { value: number };
			uDecalStyle: { value: number };
			uDecal: { value: THREE.Color };
		};
	};
};

/** One per rider: its wheels' sweep and its decal are its own; the program is shared. */
export function figureMaterial(kit: Kit, decal: THREE.Color): FigureMaterial {
	bands ??= ramp(TOON_BANDS.map((b) => b / 255));
	const m = new THREE.MeshToonMaterial({
		vertexColors: true,
		gradientMap: bands,
	}) as FigureMaterial;
	m.alphaToCoverage = true;
	const u = {
		uWheelDelta: { value: 0 },
		uDecalStyle: { value: DECAL_STYLES.indexOf(kit.wheels.decal.style) },
		uDecal: { value: decal.clone() },
	};
	m.userData.u = u;
	m.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, u, figureLight);
		sh.vertexShader = sh.vertexShader
			.replace(
				'#include <common>',
				'attribute vec3 pc;\nattribute vec3 aux;\nvarying vec3 vPc;\nflat varying vec3 vAux;\n#include <common>',
			)
			.replace(
				'#include <begin_vertex>',
				'#include <begin_vertex>\nvPc = pc; vAux = aux;',
			);
		sh.fragmentShader = sh.fragmentShader
			.replace('#include <common>', `${PARS}\n#include <common>`)
			.replace('#include <color_fragment>', WHEELS)
			.replace('#include <opaque_fragment>', LIGHT);
	};
	m.customProgramCacheKey = () => 'wattroom-figure';
	// The pose writes how far the wheels turned this frame (pose.ts); the spokes blur over it.
	m.onBeforeRender = (_r, _s, _c, _g, object) => {
		u.uWheelDelta.value = Math.abs(Number(object.userData.wheelDelta) || 0);
	};
	return m;
}
