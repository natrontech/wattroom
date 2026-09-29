// Materials: cel shading in three bands (the indie look without a post pass),
// a little wind in the trees, and a dithered fade for anything that gets
// between the camera and you — nothing generated ever blocks the view.
import * as THREE from 'three';

// A greyscale ramp for MeshToonMaterial: nearest-filtered, so the bands are hard.
export function ramp(steps: readonly number[]): THREE.DataTexture {
	const data = new Uint8Array(steps.length * 4);
	steps.forEach((s, i) => data.set([s * 255, s * 255, s * 255, 255], i * 4));
	const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
	t.minFilter = t.magFilter = THREE.NearestFilter;
	t.needsUpdate = true;
	return t;
}
export const PROP_RAMP = [0.55, 0.8, 1] as const;

// Per-frame uniforms every faded or swaying material shares: where the
// camera is, where you are, the time.
export function makeSight() {
	return {
		uCam: { value: new THREE.Vector3() },
		uYou: { value: new THREE.Vector3() },
		uTime: { value: 0 },
		uWind: { value: 0.12 }, // metres of sway at the treetop
	};
}
export type Sight = ReturnType<typeof makeSight>;

const WIND = /* glsl */ `
	#ifdef USE_INSTANCING
		vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	#else
		vec3 root = vec3(0.0);
	#endif
	float sway = sin(uTime * 1.3 + root.x * 0.07 + root.z * 0.05) * uWind * (position.y / 12.0) * (position.y / 12.0);
	transformed.x += sway;
	transformed.z += sway * 0.6;`;

// Distance to the camera→rider sightline; inside 4 m, dither away.
const FADE = /* glsl */ `
	vec3 ab = uYou - uCam;
	float t = clamp(dot(vWorld - uCam, ab) / dot(ab, ab), 0.0, 1.0);
	float d = length(vWorld - (uCam + ab * t));
	float keep = smoothstep(2.5, 6.0, d);
	int bx = int(mod(gl_FragCoord.x, 4.0)), by = int(mod(gl_FragCoord.y, 4.0));
	float bayer[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
	if (keep < (bayer[by * 4 + bx] + 0.5) / 16.0) discard;`;

export function toon(
	gradientMap: THREE.Texture,
	sight: Sight,
	opts: { wind?: boolean; fade?: boolean } = {},
): THREE.MeshToonMaterial {
	const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
	if (!opts.wind && !opts.fade) return m;
	m.onBeforeCompile = (s) => {
		Object.assign(s.uniforms, sight);
		s.vertexShader = s.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nuniform float uTime;\nuniform float uWind;\nvarying vec3 vWorld;',
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>\n${opts.wind ? WIND : ''}`,
			)
			.replace(
				'#include <worldpos_vertex>',
				`#include <worldpos_vertex>
				vec4 wp = vec4(transformed, 1.0);
				#ifdef USE_INSTANCING
					wp = instanceMatrix * wp;
				#endif
				vWorld = (modelMatrix * wp).xyz;`,
			);
		if (opts.fade)
			s.fragmentShader = s.fragmentShader
				.replace(
					'#include <common>',
					'#include <common>\nuniform vec3 uCam;\nuniform vec3 uYou;\nvarying vec3 vWorld;',
				)
				.replace(
					'#include <clipping_planes_fragment>',
					`#include <clipping_planes_fragment>\n${FADE}`,
				);
	};
	m.customProgramCacheKey = () =>
		`toon-${opts.wind ? 'w' : ''}${opts.fade ? 'f' : ''}`;
	return m;
}
