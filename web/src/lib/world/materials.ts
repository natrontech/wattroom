// Materials: the dressing flat shaded, one normal per face (ADR-0092), a
// little wind in the trees, and a dithered fade for anything that gets
// between the camera and you — nothing generated ever blocks the view.
import * as THREE from 'three';
import { smoothstep } from './rand';

// A greyscale ramp for the figures' MeshToonMaterial: nearest-filtered, so the bands are hard.
export function ramp(steps: readonly number[]): THREE.DataTexture {
	const data = new Uint8Array(steps.length * 4);
	steps.forEach((s, i) => data.set([s * 255, s * 255, s * 255, 255], i * 4));
	const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
	t.minFilter = t.magFilter = THREE.NearestFilter;
	t.needsUpdate = true;
	return t;
}

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
	#if defined(USE_INSTANCING)
		vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	#elif defined(USE_BATCHING)
		vec3 root = (batchingMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	#else
		vec3 root = vec3(0.0);
	#endif
	float sway = sin(uTime * 1.3 + root.x * 0.07 + root.z * 0.05) * uWind * (position.y / 12.0) * (position.y / 12.0);
	transformed.x += sway;
	transformed.z += sway * 0.6;`;

/** Metres off the camera→rider sightline inside which the dressing dithers away, and outside which it is whole (#3220 O7). */
const FADE_M = [2.5, 6.0] as const;
/**
 * Metres past you, over the ground the way the camera looks, over which the
 * fade lets go (#4424): nothing beyond you can hide you, so a road sign
 * ahead stays until you pass it. Your bike reaches about this far ahead of
 * where you are. Over the ground, since a sign's face stands above you and
 * a camera looking down would measure it nearer by its height.
 */
const PAST_M = 1.0;

/**
 * How much of the dressing at `p` the sightline fade keeps, 0 to 1: the FADE
 * chunk below, line for line, so a test can ride it in every camera.
 */
export function sightKeep(
	p: THREE.Vector3,
	cam: THREE.Vector3,
	you: THREE.Vector3,
): number {
	const ab = new THREE.Vector3().subVectors(you, cam);
	const t = Math.min(
		Math.max(new THREE.Vector3().subVectors(p, cam).dot(ab) / ab.dot(ab), 0),
		1,
	);
	const d = p.distanceTo(new THREE.Vector3().copy(cam).addScaledVector(ab, t));
	const reach = Math.max(Math.hypot(ab.x, ab.z), 1e-4);
	const past = ((p.x - cam.x) * ab.x + (p.z - cam.z) * ab.z) / reach - reach;
	return Math.max(
		smoothstep(FADE_M[0], FADE_M[1], d),
		smoothstep(0, PAST_M, past),
	);
}

// Distance to the camera→rider sightline: near it, dither away, but never
// past you (sightKeep, above).
const FADE = /* glsl */ `
	vec3 ab = uYou - uCam;
	float t = clamp(dot(vWorld - uCam, ab) / dot(ab, ab), 0.0, 1.0);
	float d = length(vWorld - (uCam + ab * t));
	float reach = max(length(ab.xz), 1e-4);
	float past = dot(vWorld.xz - uCam.xz, ab.xz) / reach - reach;
	float keep = max(
		smoothstep(${FADE_M[0].toFixed(1)}, ${FADE_M[1].toFixed(1)}, d),
		smoothstep(0.0, ${PAST_M.toFixed(1)}, past)
	);
	int bx = int(mod(gl_FragCoord.x, 4.0)), by = int(mod(gl_FragCoord.y, 4.0));
	float bayer[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
	if (keep < (bayer[by * 4 + bx] + 0.5) / 16.0) discard;`;

// A face turned to the ground is lit as one turned out (#4256): the
// hemisphere's ground colour alone takes a tier's or an eave's underside to
// black, and the world's shadow is a tint, never black (ADR-0072).
const UNDERSIDE = /* glsl */ `
	vec3 upView = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
	float toSky = dot( normal, upView );
	if ( toSky < 0.0 ) {
		vec3 level = normal - toSky * upView;
		normal = length( level ) > 1e-3 ? normalize( level ) : normalize( cross( upView, vec3( 0.0, 0.0, 1.0 ) ) );
	}`;

/** What a tree's colours are multiplied by where it stands in snow (props/batch.ts): far past any colour, so the material reads it as a mark, and divides it out again. */
export const SNOWED_BY = 256;
/** A vertex colour brighter than this is that mark. */
const SNOWED_OVER = 4;
/** What a lamp's colours are multiplied by (structures.ts, a tunnel's): under nought, so the material reads it as a mark and draws the face its own colour, lit or not. Only a `lit` material reads it. */
export const LIT = -1;

/**
 * The dressing's material (ADR-0092): its models' colours, flat per face,
 * lit by the sky with one normal per face, so a change of shade falls on a
 * triangle's edge, where the renderer's antialiasing reaches.
 */
export function flat(
	sight: Sight,
	opts: {
		wind?: boolean;
		fade?: boolean;
		/** A tree's darkest and lightest green, foot to tip: where it stands in snow, its tip is white and its skirts keep their green under a dusting. None: snowed all over. */
		snow?: { lo: string; hi: string };
		/** Faces marked LIT are drawn their own colour, a tunnel's lamps: flat, never a glow. */
		lit?: boolean;
	} = {},
): THREE.MeshLambertMaterial {
	const m = new THREE.MeshLambertMaterial({
		vertexColors: true,
		flatShading: true,
	});
	m.onBeforeCompile = (s) => {
		s.fragmentShader = s.fragmentShader.replace(
			'#include <normal_fragment_begin>',
			`#include <normal_fragment_begin>\n${UNDERSIDE}`,
		);
		// A tree in snow (props/batch.ts): its colours come multiplied far past any colour, and are drawn snow.
		// Half of it keeps its white in the shade, where a face turned from the sun would be drawn as dark as a green tree's.
		const greens = opts.snow && [
			new THREE.Color(opts.snow.lo).g,
			new THREE.Color(opts.snow.hi).g,
		];
		s.uniforms.uSnowGreen = {
			value: new THREE.Vector2(greens?.[0] ?? 0, greens?.[1] ?? 1e-4),
		};
		s.fragmentShader = s.fragmentShader
			.replace(
				'#include <common>',
				'#include <common>\nuniform vec2 uSnowGreen;',
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
				bool snowed = false;
				float snowOn = 0.0;
				#ifdef USE_COLOR
					snowed = max(vColor.r, max(vColor.g, vColor.b)) > ${SNOWED_OVER.toFixed(1)};
					if (snowed) {
						vec3 own = vColor.rgb / ${SNOWED_BY.toFixed(1)};
						float up = clamp((own.g - uSnowGreen.x) / max(uSnowGreen.y - uSnowGreen.x, 1e-4), 0.0, 1.0);
						snowOn = mix(0.28, 1.0, smoothstep(0.3, 0.72, up));
						diffuseColor.rgb = mix(own, vec3(0.84, 0.88, 1.0), snowOn);
					}
				#endif`,
			)
			.replace(
				'#include <opaque_fragment>',
				`if (snowed) outgoingLight = mix(outgoingLight, vec3(0.8, 0.83, 0.96), 0.5 * snowOn);
				${
					opts.lit
						? `#ifdef USE_COLOR
					if (vColor.r < 0.0) outgoingLight = vColor.rgb / ${LIT.toFixed(1)};
				#endif`
						: ''
				}
				#include <opaque_fragment>`,
			);
		if (!opts.wind && !opts.fade) return;
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
				#ifdef USE_BATCHING
					wp = batchingMatrix * wp;
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
		`flat-${opts.wind ? 'w' : ''}${opts.fade ? 'f' : ''}${opts.lit ? 'l' : ''}${opts.snow ? `${opts.snow.lo}${opts.snow.hi}` : ''}`;
	return m;
}
