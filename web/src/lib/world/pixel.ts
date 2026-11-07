// Pixel 3D: the world drawn in whole pixels, the way the lounge is. The scene
// renders into a target at the canvas ÷ S, S a whole number of the device's
// own pixels; one pass brings it to the canvas nearest-neighbour, each world
// pixel exactly S × S of the screen's, and draws a one-pixel ink edge where
// the ground falls away behind a thing. Words (name tags) draw after, at the
// canvas's own resolution, so a name stays readable.
import * as THREE from 'three';
import { LOUNGE } from '$lib/lounge/palette';

/** The layer words draw on: over the pixels, never pixelated. */
export const WORDS = 1;

/** World pixels along the canvas's longer side: what lands on the room's own pixel at a desk's sizes (docs/spec/world.md, "Pixels"). */
const ACROSS = 380;

/**
 * The whole pixels one world pixel takes on a drawing buffer w × h: the
 * longer side decides, so a phone held upright draws as chunky as a laptop
 * (the lounge's 2 CSS pixels on a phone, 6 of a 3× phone's own). Never under 1.
 */
export function pixelScale(w: number, h: number): number {
	return Math.max(1, Math.round(Math.max(w, h) / ACROSS));
}

/**
 * On while a Pixel 3D pass draws: every material that steps its light and
 * its fog reads this one uniform, so a material built for one look draws
 * the other when the rider switches.
 */
export const PIXEL = { value: 0 };

/** On while Diorama 3D draws (diorama.ts): the light takes the same steps, at the screen's own pixels. */
export const DIORAMA = { value: 0 };

/** How fast you ride (m/s) and the clock, for the wind at the frame's edges; speed 0 draws none. */
export const MOTION = { speed: { value: 0 }, time: { value: 0 } };

/** The Pixel 3D target's size in world pixels: what a sprite stands on (avatar.ts). */
export const TARGET = { value: new THREE.Vector2(1, 1) };

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
	}
	float pixelFog(float f) { return floor(f * 6.0 + 0.5) / 6.0; }`;

const DIRECT =
	'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
const FOG = 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );';
const LAMBERT = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
	DIRECT,
	`${DIRECT}
	if ( max( uPixel, uDiorama ) > 0.5 ) dotNL = pixelStep( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );`,
);
// The sky's light in quarters of the way from the ground's: a vertical face keeps its half, a rounded back steps.
const HEMI = THREE.ShaderChunk.lights_pars_begin.replace(
	'float hemiDiffuseWeight = 0.5 * dotNL + 0.5;',
	`float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		if ( max( uPixel, uDiorama ) > 0.5 ) hemiDiffuseWeight = floor( hemiDiffuseWeight * 4.0 + 0.5 ) / 4.0;`,
);
// A toon material (the riders, the team car) takes the same four steps in place of its gradient map.
const TOON = THREE.ShaderChunk.gradientmap_pars_fragment.replace(
	'float dotNL = dot( normal, lightDirection );',
	`float dotNL = dot( normal, lightDirection );
	if ( max( uPixel, uDiorama ) > 0.5 ) return vec3( pixelStep( dotNL * 0.5 + 0.5 ) );`,
);
const FOGGED = THREE.ShaderChunk.fog_fragment.replace(
	FOG,
	`if ( uPixel > 0.5 ) fogFactor = pixelFog( fogFactor );
	${FOG}`,
);
const patched = new WeakSet<THREE.Material>();

/**
 * Gives a Lambert or toon material the ramp: its sun in four flat steps,
 * its fog in flat bands. Once per material; the steps show while PIXEL is
 * on. A ramped program defines PIXEL_RAMP, so a material's own chunks can
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
		shader.uniforms.uPixel = PIXEL;
		shader.uniforms.uDiorama = DIORAMA;
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>\n#define PIXEL_RAMP\nuniform float uPixel;\nuniform float uDiorama;\n${STEPS}`,
			)
			.replace('#include <lights_pars_begin>', HEMI)
			.replace('#include <lights_lambert_pars_fragment>', LAMBERT)
			.replace('#include <gradientmap_pars_fragment>', TOON)
			.replace('#include <fog_fragment>', FOGGED);
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

/** How much farther than the face's own plane a neighbour must be to ink the face's edge: the prototype's 6 %. */
const STEP = 0.94;

const VERTEX = /* glsl */ `
	void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// 1/z is linear across the screen on any plane, so a neighbour is past an
// edge when it sits behind the plane through this pixel and the one opposite,
// by a step twice the one this pixel took: a road seen flat to the horizon,
// or a meadow folding gently, never inks itself; a rider against it does.
// The ink fades into the fog as the faces do, so a far ridge is a soft line.
const FRAGMENT = /* glsl */ `
	uniform sampler2D tColor;
	uniform sampler2D tDepth;
	uniform vec2 texel;
	uniform float scale;
	uniform float near;
	uniform float far;
	uniform vec3 ink;
	uniform float density;
	uniform float uSpeed;
	uniform float uTime;
	${STEPS}
	float iz(vec2 uv) { return (far - texture2D(tDepth, uv).r * (far - near)) / (near * far); }
	bool ground(vec2 uv) { return texture2D(tColor, uv).a < 0.75; }
	bool past(float n, float c, float o) { return n < (2.0 * c - o) * ${STEP} && c - n > 2.0 * (o - c); }
	void main() {
		vec2 uv = (floor(gl_FragCoord.xy / scale) + 0.5) * texel; // S × S of the screen's pixels a world pixel
		vec2 dx = vec2(texel.x, 0.0);
		vec2 dy = vec2(0.0, texel.y);
		float c = iz(uv), l = iz(uv - dx), r = iz(uv + dx), b = iz(uv - dy), t = iz(uv + dy);
		vec4 face = texture2D(tColor, uv);
		// The land keeps no outline of its own: a fold in a field is not an edge,
		// and only a thing standing on the land, or the land against the sky, is.
		bool land = face.a < 0.75;
		bool edge = (past(l, c, r) && !(land && ground(uv - dx)))
			|| (past(r, c, l) && !(land && ground(uv + dx)))
			|| (past(b, c, t) && !(land && ground(uv - dy)))
			|| (past(t, c, b) && !(land && ground(uv + dy)));
		float fog = pixelFog(1.0 - exp(-pow(density / c, 2.0)));
		// Far off an outline would be all a small thing is: it goes to the thing's own shade.
		vec3 line = mix(ink, face.rgb * 0.62, smoothstep(45.0, 170.0, 1.0 / c));
		vec3 rgb = edge ? mix(line, face.rgb, fog) : face.rgb;
		// Wind past you at the frame's edges, faster and thicker the faster you ride: whole pixels, a lighter streak, never a blur.
		float kmh = uSpeed * 3.6;
		if (kmh > 20.0) {
			vec2 q = uv - 0.5;
			float r = length(q * vec2(1.0, 0.75));
			if (r > 0.34) {
				float lane = floor(atan(q.y, q.x) * 70.0);
				float h = fract(sin(lane * 12.9898) * 43758.5453);
				float many = clamp((kmh - 20.0) / 30.0, 0.0, 1.0) * 0.22;
				float along = fract(r * 4.0 - uTime * (0.6 + kmh / 40.0) + h * 7.0);
				if (h > 1.0 - many && along < 0.12) rgb = mix(rgb, vec3(1.0), 0.28);
			}
		}
		gl_FragColor = vec4(rgb, 1.0);
		#include <colorspace_fragment>
	}`;

export function pixelPass(renderer: THREE.WebGLRenderer) {
	const target = new THREE.WebGLRenderTarget(1, 1, {
		minFilter: THREE.NearestFilter,
		magFilter: THREE.NearestFilter,
		generateMipmaps: false,
		colorSpace: THREE.SRGBColorSpace, // eight bits a channel stored as sRGB: the dusk's darks do not band
		depthTexture: new THREE.DepthTexture(1, 1),
	});
	const post = new THREE.ShaderMaterial({
		uniforms: {
			tColor: { value: target.texture },
			tDepth: { value: target.depthTexture },
			texel: { value: new THREE.Vector2(1, 1) },
			scale: { value: 1 },
			near: { value: 1 },
			far: { value: 2 },
			ink: { value: new THREE.Color() },
			density: { value: 0 },
			uSpeed: MOTION.speed,
			uTime: MOTION.time,
		},
		vertexShader: VERTEX,
		fragmentShader: FRAGMENT,
		depthTest: false,
		depthWrite: false,
	});
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
	quad.frustumCulled = false;
	const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	// Three passes a frame: the renderer counts them all, and probe() reads the sum.
	renderer.info.autoReset = false;
	PIXEL.value = 1;

	const buffer = new THREE.Vector2();
	/** The target for the canvas's drawing buffer as it is now, in whole cells of S of its pixels. */
	function sized() {
		renderer.getDrawingBufferSize(buffer);
		const s = pixelScale(buffer.x, buffer.y);
		const cols = Math.max(1, Math.ceil(buffer.x / s));
		const rows = Math.max(1, Math.ceil(buffer.y / s));
		if (target.width !== cols || target.height !== rows) {
			target.setSize(cols, rows);
			post.uniforms.texel.value.set(1 / cols, 1 / rows);
		}
		post.uniforms.scale.value = s;
		TARGET.value.set(cols, rows);
		return target;
	}

	return {
		sized,
		/** Draws `scene` from `camera` onto the canvas in whole pixels. */
		render(scene: THREE.Object3D, camera: THREE.PerspectiveCamera) {
			renderer.info.reset();
			rampAll(scene); // ponytail: a walk of the scene a frame; the world is a few dozen meshes (probe())
			// ponytail: the lounge's ink as the lounge last turned it (the dark room's until a lounge drew);
			// applying the theme here would hide a change from the lounge's own caches.
			post.uniforms.ink.value.set(LOUNGE.ink);
			post.uniforms.near.value = camera.near;
			post.uniforms.far.value = camera.far;
			const fog = (scene as THREE.Scene).fog;
			post.uniforms.density.value =
				fog instanceof THREE.FogExp2 ? fog.density : 0;
			const layers = camera.layers.mask;
			camera.layers.set(0);
			const t = sized();
			const s = post.uniforms.scale.value;
			// Whole cells reach a little past the canvas's top and right: the target sees that far, so each lands where it shows.
			camera.setViewOffset(
				buffer.x,
				buffer.y,
				0,
				buffer.y - t.height * s,
				t.width * s,
				t.height * s,
			);
			renderer.setRenderTarget(t);
			renderer.render(scene, camera);
			renderer.setRenderTarget(null);
			camera.clearViewOffset();
			renderer.render(quad, flat);
			camera.layers.set(WORDS);
			renderer.autoClear = false;
			renderer.render(scene, camera);
			renderer.autoClear = true;
			camera.layers.mask = layers;
		},
		dispose() {
			PIXEL.value = 0;
			target.depthTexture?.dispose();
			target.dispose();
			post.dispose();
			quad.geometry.dispose();
		},
	};
}
