// After dusk a village lights up (docs/spec/world.md, "Lights"): its windows
// and lamp heads in the lounge's amber, flat and never a glow, and a pool of
// it on the ground under each lamp. Each light eases on over --dur-draw, a
// village's one after another, so nothing flashes (WCAG 2.3.1).
import * as THREE from 'three';
import { LOUNGE } from '$lib/lounge/palette';
import { flat, type Sight } from './materials';

/** --dur-draw (docs/spec/motion.md): how long one light takes to come on. */
const EASE_S = 1.2;
/** Over how long a village's lights come on, one after another. */
const SPREAD_S = 6;
/** The pools the ground draws: those of the lamps nearest the eye. */
export const POOLS = 8;
/** A pool's radius on the ground. */
const POOL_M = 4;
/** When the lights come on while they are off: never. */
export const OFF = 1e9;

/** What every lit material shares: the clock, when the lights came on, the amber and the pools (xy) with their lamps (zw). */
export function lightsUniforms(time = { value: 0 }) {
	return {
		uTime: time,
		uLitAt: { value: OFF },
		uAmber: { value: new THREE.Color(LOUNGE.amber) },
		uLamps: {
			value: Array.from(
				{ length: POOLS },
				() => new THREE.Vector4(OFF, OFF, OFF, OFF),
			),
		},
	};
}
export type Lights = ReturnType<typeof lightsUniforms>;

/**
 * GLSL, with uTime declared by its caller: how far on the light standing at
 * `at` (x, z) is, 0–1. Each waits its share of the spread by where it stands,
 * so a street's lamps come on one after another down it.
 */
const ON = /* glsl */ `
	uniform float uLitAt;
	float lightOn(vec2 at) {
		float wait = fract(dot(floor(at), vec2(0.0371, 0.0529))) * ${SPREAD_S.toFixed(1)};
		return smoothstep(0.0, 1.0, (uTime - uLitAt - wait) / ${EASE_S.toFixed(1)});
	}`;

/** GLSL for a ground's fragment: `lampPool(p)` is how much of a pool falls on world point p, 0–0.7, the lounge's density at its centre. */
export const POOL = /* glsl */ `
	uniform float uTime;
	uniform vec3 uAmber;
	uniform vec4 uLamps[${POOLS}];
	${ON}
	float lampPool(vec3 p) {
		float a = 0.0;
		for (int i = 0; i < ${POOLS}; i++)
			a = max(a, (1.0 - length(p.xz - uLamps[i].xy) / ${POOL_M.toFixed(1)}) * lightOn(uLamps[i].zw));
		return a * 0.7;
	}`;

/**
 * The lights' own material: a window or a lamp head in its pane's colour
 * by day, amber once its light is on; in whole pixels it is on or off. It fades
 * near the sightline as its house does.
 */
export function lightsMaterial(sight: Sight, lights: Lights) {
	const m = flat(sight, { fade: true });
	const own = m.onBeforeCompile;
	m.onBeforeCompile = (s, renderer) => {
		own.call(m, s, renderer);
		Object.assign(s.uniforms, {
			uLitAt: lights.uLitAt,
			uAmber: lights.uAmber,
		});
		s.vertexShader = s.vertexShader
			// After main's declarations: uTime is the fade's (materials.ts).
			.replace('void main() {', `${ON}\nvarying float vOn;\nvoid main() {`)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				#ifdef USE_BATCHING
					vOn = lightOn((batchingMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz);
				#else
					vOn = 0.0;
				#endif`,
			);
		s.fragmentShader = s.fragmentShader
			.replace(
				'#include <common>',
				'#include <common>\nuniform vec3 uAmber;\nvarying float vOn;',
			)
			.replace(
				'#include <emissivemap_fragment>',
				`#include <emissivemap_fragment>
				float on = vOn;
				diffuseColor.rgb *= 1.0 - on;
				totalEmissiveRadiance = uAmber * on;`,
			);
	};
	m.customProgramCacheKey = () => 'lights';
	return m;
}
