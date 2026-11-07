// The room's light on the world's models (Diorama 3D, diorama.ts): a
// Lambert or toon material's sun in four flat steps and the sky's in
// quarters, as the cozy room is lit. Plus what the sprites and passes share:
// the words' layer, the motion clock, the room's ordered dither.
import * as THREE from 'three';

/** The layer words draw on: over the pass, never blurred. */
export const WORDS = 1;

/** On while Diorama 3D draws (diorama.ts): the light takes the same steps, at the screen's own pixels. */
export const DIORAMA = { value: 0 };

/** How fast you ride (m/s) and the clock, for the wind at the frame's edges; speed 0 draws none. */
export const MOTION = { speed: { value: 0 }, time: { value: 0 } };

/** The lounge's ordered dither (lounge/pixel.ts): a 4 × 4 Bayer threshold, 0–1, per pixel. */
export const BAYER = /* glsl */ `
	float pixelBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
	float pixelBayer(vec2 a) { return pixelBayer2(0.5 * a) * 0.25 + pixelBayer2(a); }`;

/**
 * The prototype's ramp: a half-Lambert light, 0–1, as one of four steps
 * (shadow, base, light, lit top), with a hard edge between them.
 */
export const STEPS = /* glsl */ `
	float pixelStep(float l) {
		return l < 0.38 ? 0.0 : l < 0.62 ? 1.0 / 3.0 : l < 0.84 ? 2.0 / 3.0 : 1.0;
	}`;

const DIRECT =
	'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
const LAMBERT = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
	DIRECT,
	`${DIRECT}
	if ( uDiorama > 0.5 ) dotNL = pixelStep( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );`,
);
// The sky's light in quarters of the way from the ground's: a vertical face keeps its half, a rounded back steps.
const HEMI = THREE.ShaderChunk.lights_pars_begin.replace(
	'float hemiDiffuseWeight = 0.5 * dotNL + 0.5;',
	`float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		if ( uDiorama > 0.5 ) hemiDiffuseWeight = floor( hemiDiffuseWeight * 4.0 + 0.5 ) / 4.0;`,
);
// A toon material (the riders, the team car) takes the same four steps in place of its gradient map.
const TOON = THREE.ShaderChunk.gradientmap_pars_fragment.replace(
	'float dotNL = dot( normal, lightDirection );',
	`float dotNL = dot( normal, lightDirection );
	if ( uDiorama > 0.5 ) return vec3( pixelStep( dotNL * 0.5 + 0.5 ) );`,
);
const patched = new WeakSet<THREE.Material>();

/**
 * Gives a Lambert or toon material the ramp: its sun in four flat steps,
 * the sky's in quarters. Once per material; the steps show while DIORAMA
 * is on. A ramped program defines PIXEL_RAMP, so a material's own chunks can
 * step too (figure/material.ts).
 */
function ramp(m: THREE.Material) {
	if (
		patched.has(m) ||
		!(
			m instanceof THREE.MeshLambertMaterial ||
			m instanceof THREE.MeshToonMaterial
		)
	)
		return;
	patched.add(m);
	const original = m.onBeforeCompile;
	// Three keys a program by onBeforeCompile's source: keep the original's, or every ramped material would share one.
	const own =
		m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey
			? () => original.toString()
			: m.customProgramCacheKey.bind(m);
	m.onBeforeCompile = (shader, renderer) => {
		original.call(m, shader, renderer);
		shader.uniforms.uDiorama = DIORAMA;
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>\n#define PIXEL_RAMP\nuniform float uDiorama;\n${STEPS}`,
			)
			.replace('#include <lights_pars_begin>', HEMI)
			.replace('#include <lights_lambert_pars_fragment>', LAMBERT)
			.replace('#include <gradientmap_pars_fragment>', TOON);
	};
	m.customProgramCacheKey = () => `pixel|${own()}`;
	m.needsUpdate = true;
}

/** Ramps every Lambert and toon material under `root` not ramped yet: what streams in is caught on its first frame. */
export function rampAll(root: THREE.Object3D) {
	root.traverse((o) => {
		const m = (o as THREE.Mesh).material;
		if (!m) return;
		if (Array.isArray(m)) m.forEach(ramp);
		else ramp(m);
	});
}
