// Pixel 3D: the world drawn in whole pixels, the way the lounge is. The scene
// renders into a target at the canvas ÷ S, S the lounge's whole scale; one
// pass brings it to the canvas nearest-neighbour and draws a one-pixel ink
// edge where the ground falls away behind a thing. Words (name tags) draw
// after, at the canvas's own resolution, so a name stays readable.
import * as THREE from 'three';
import { LOUNGE } from '$lib/lounge/palette';

/** The layer words draw on: over the pixels, never pixelated. */
export const WORDS = 1;

/** World pixels along the canvas's longer side: the lounge's 320 to 480 (docs/spec/world.md, "Pixels"). */
const ACROSS = 400;

/**
 * The whole CSS pixels one world pixel takes on a canvas w × h CSS pixels:
 * the longer side decides, so a phone held upright draws as chunky as a
 * laptop (the lounge's 2 on a phone). Never under 1.
 */
export function pixelScale(w: number, h: number): number {
	return Math.max(1, Math.round(Math.max(w, h) / ACROSS));
}

/** How much farther than the face's own plane a neighbour must be to ink the face's edge: the prototype's 6 %. */
const STEP = 0.94;

const VERTEX = /* glsl */ `
	varying vec2 vUv;
	void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// 1/z is linear across the screen on any plane, so a neighbour is past an
// edge when it sits behind the plane through this pixel and the one opposite,
// by a step twice the one this pixel took: a road seen flat to the horizon,
// or a meadow folding gently, never inks itself; a rider against it does.
// The ink fades into the fog as the faces do, so a far ridge is a soft line.
const FRAGMENT = /* glsl */ `
	uniform sampler2D tColor;
	uniform sampler2D tDepth;
	uniform vec2 texel;
	uniform float near;
	uniform float far;
	uniform vec3 ink;
	uniform float density;
	varying vec2 vUv;
	float iz(vec2 uv) { return (far - texture2D(tDepth, uv).r * (far - near)) / (near * far); }
	bool past(float n, float c, float o) { return n < (2.0 * c - o) * ${STEP} && c - n > 2.0 * (o - c); }
	void main() {
		vec2 uv = (floor(vUv / texel) + 0.5) * texel;
		vec2 dx = vec2(texel.x, 0.0);
		vec2 dy = vec2(0.0, texel.y);
		float c = iz(uv), l = iz(uv - dx), r = iz(uv + dx), b = iz(uv - dy), t = iz(uv + dy);
		bool edge = past(l, c, r) || past(r, c, l) || past(b, c, t) || past(t, c, b);
		vec4 face = texture2D(tColor, uv);
		float fog = 1.0 - exp(-pow(density / c, 2.0));
		gl_FragColor = edge ? vec4(mix(ink, face.rgb, fog), 1.0) : face;
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
			near: { value: 1 },
			far: { value: 2 },
			ink: { value: new THREE.Color() },
			density: { value: 0 },
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

	/** The target for a canvas of w × h CSS pixels, sized to it. */
	function sized(w: number, h: number) {
		const s = pixelScale(w, h);
		const cols = Math.max(1, Math.ceil(w / s));
		const rows = Math.max(1, Math.ceil(h / s));
		if (target.width !== cols || target.height !== rows) {
			target.setSize(cols, rows);
			post.uniforms.texel.value.set(1 / cols, 1 / rows);
		}
		return target;
	}

	return {
		sized,
		/** Draws `scene` from `camera` onto the canvas, `w` × `h` CSS pixels, in whole pixels. */
		render(
			scene: THREE.Object3D,
			camera: THREE.PerspectiveCamera,
			w: number,
			h: number,
		) {
			renderer.info.reset();
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
			renderer.setRenderTarget(sized(w, h));
			renderer.render(scene, camera);
			renderer.setRenderTarget(null);
			renderer.render(quad, flat);
			camera.layers.set(WORDS);
			renderer.autoClear = false;
			renderer.render(scene, camera);
			renderer.autoClear = true;
			camera.layers.mask = layers;
		},
		dispose() {
			target.depthTexture?.dispose();
			target.dispose();
			post.dispose();
			quad.geometry.dispose();
		},
	};
}
