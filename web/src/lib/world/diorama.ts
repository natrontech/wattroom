// Diorama 3D: the world at the screen's own resolution, lit in the room's
// steps, with a thin ink line where a thing stands against what is behind
// it, and blurred toward the top and the bottom of the frame like a
// photograph of a model railway. The people in it are the room's sprites
// (avatar.ts), crisp at any size. Words draw after, sharp.
import * as THREE from 'three';
import { LOUNGE } from '$lib/lounge/palette';
import { DIORAMA, MOTION, rampAll, TARGET, WORDS } from './pixel';
import { SPRITE_SCREEN } from './rider-sprite';

const VERTEX = /* glsl */ `
	varying vec2 vUv;
	void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** How much farther than the face's own plane a neighbour must be to ink the face's edge (pixel.ts). */
const STEP = 0.94;

// The ink: pixel.ts's test, one CSS pixel wide. The land keeps no outline of
// its own (it writes alpha 0.5), so only a thing on it, or a ridge against
// the sky, is drawn round. Then the grade: a little warmer, a little fuller.
const INK = /* glsl */ `
	uniform sampler2D tColor;
	uniform sampler2D tDepth;
	uniform vec2 texel;
	uniform float width;
	uniform float near;
	uniform float far;
	uniform vec3 ink;
	varying vec2 vUv;
	float iz(vec2 uv) { return (far - texture2D(tDepth, uv).r * (far - near)) / (near * far); }
	bool ground(vec2 uv) { return texture2D(tColor, uv).a < 0.75; }
	bool past(float n, float c, float o) { return n < (2.0 * c - o) * ${STEP} && c - n > 2.0 * (o - c); }
	void main() {
		vec2 dx = vec2(texel.x * width, 0.0);
		vec2 dy = vec2(0.0, texel.y * width);
		float c = iz(vUv), l = iz(vUv - dx), r = iz(vUv + dx), b = iz(vUv - dy), t = iz(vUv + dy);
		vec4 face = texture2D(tColor, vUv);
		bool land = face.a < 0.75;
		bool edge = (past(l, c, r) && !(land && ground(vUv - dx)))
			|| (past(r, c, l) && !(land && ground(vUv + dx)))
			|| (past(b, c, t) && !(land && ground(vUv - dy)))
			|| (past(t, c, b) && !(land && ground(vUv + dy)));
		// Far off the line goes to the thing's own shade, then away.
		float far_ = smoothstep(40.0, 160.0, 1.0 / c);
		vec3 line = mix(ink, face.rgb * 0.6, far_);
		vec3 rgb = edge ? mix(line, face.rgb, far_ * 0.6) : face.rgb;
		// Warmer and fuller, as the room's lamp-lit colours are.
		float grey = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
		rgb = mix(vec3(grey), rgb, 1.18) * vec3(1.04, 1.0, 0.95);
		gl_FragColor = vec4(rgb, 1.0);
	}`;

// The miniature: a disc of taps, wider the farther a pixel is from the band
// the riders ride in. The band sits a little under the middle, where the
// chase camera keeps you; the sky blurs most, the road at your feet a little.
const SHIFT = /* glsl */ `
	uniform sampler2D tColor;
	uniform vec2 texel;
	uniform float radius;
	uniform float uSpeed;
	uniform float uTime;
	varying vec2 vUv;
	const int TAPS = 24;
	void main() {
		float y = vUv.y;
		float blur = smoothstep(0.5, 0.92, y) + 0.55 * smoothstep(0.2, 0.0, y);
		vec3 sum = texture2D(tColor, vUv).rgb;
		float n = 1.0;
		if (blur > 0.01) {
			float golden = 2.39996;
			for (int i = 1; i < TAPS; i++) {
				float k = float(i);
				float rr = sqrt(k / float(TAPS)) * radius * blur;
				vec2 o = vec2(cos(k * golden), sin(k * golden)) * rr * texel;
				sum += texture2D(tColor, vUv + o).rgb;
				n += 1.0;
			}
		}
		vec3 rgb = sum / n;
		// A soft edge to the frame, the way a lens sees a table.
		vec2 q = vUv - 0.5;
		rgb *= 1.0 - 0.32 * smoothstep(0.32, 0.78, length(q * vec2(1.0, 0.8)));
		gl_FragColor = vec4(rgb, 1.0);
		#include <colorspace_fragment>
	}`;

/** The pass: the scene into a multisampled target, the ink, then the miniature's blur onto the canvas. */
export function dioramaPass(renderer: THREE.WebGLRenderer) {
	const target = new THREE.WebGLRenderTarget(1, 1, {
		samples: 4,
		colorSpace: THREE.SRGBColorSpace,
		depthTexture: new THREE.DepthTexture(1, 1),
	});
	const inked = new THREE.WebGLRenderTarget(1, 1, {
		colorSpace: THREE.SRGBColorSpace,
	});
	const ink = new THREE.ShaderMaterial({
		uniforms: {
			tColor: { value: target.texture },
			tDepth: { value: target.depthTexture },
			texel: { value: new THREE.Vector2(1, 1) },
			width: { value: 1 },
			near: { value: 1 },
			far: { value: 2 },
			ink: { value: new THREE.Color() },
		},
		vertexShader: VERTEX,
		fragmentShader: INK,
		depthTest: false,
		depthWrite: false,
	});
	const shift = new THREE.ShaderMaterial({
		uniforms: {
			tColor: { value: inked.texture },
			texel: { value: new THREE.Vector2(1, 1) },
			radius: { value: 8 },
			uSpeed: MOTION.speed,
			uTime: MOTION.time,
		},
		vertexShader: VERTEX,
		fragmentShader: SHIFT,
		depthTest: false,
		depthWrite: false,
	});
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ink);
	quad.frustumCulled = false;
	const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	renderer.info.autoReset = false;
	DIORAMA.value = 1;

	const buffer = new THREE.Vector2();
	function sized() {
		renderer.getDrawingBufferSize(buffer);
		const w = Math.max(1, buffer.x);
		const h = Math.max(1, buffer.y);
		if (target.width !== w || target.height !== h) {
			target.setSize(w, h);
			inked.setSize(w, h);
			ink.uniforms.texel.value.set(1 / w, 1 / h);
			shift.uniforms.texel.value.set(1 / w, 1 / h);
		}
		// The villagers' grid (avatar.ts): the room's pixel, two CSS pixels, whatever the canvas.
		const s = Math.max(1, Math.round(2 * renderer.getPixelRatio()));
		TARGET.value.set(Math.ceil(w / s), Math.ceil(h / s));
		SPRITE_SCREEN.halfH.value = h / 2;
		const css = renderer.getPixelRatio();
		ink.uniforms.width.value = Math.max(1, Math.round(css));
		shift.uniforms.radius.value = 7 * css;
		return target;
	}

	return {
		sized,
		render(scene: THREE.Object3D, camera: THREE.PerspectiveCamera) {
			renderer.info.reset();
			rampAll(scene);
			ink.uniforms.ink.value.set(LOUNGE.ink);
			ink.uniforms.near.value = camera.near;
			ink.uniforms.far.value = camera.far;
			const layers = camera.layers.mask;
			camera.layers.set(0);
			renderer.setRenderTarget(sized());
			renderer.render(scene, camera);
			quad.material = ink;
			renderer.setRenderTarget(inked);
			renderer.render(quad, flat);
			renderer.setRenderTarget(null);
			quad.material = shift;
			renderer.render(quad, flat);
			camera.layers.set(WORDS);
			renderer.autoClear = false;
			renderer.render(scene, camera);
			renderer.autoClear = true;
			camera.layers.mask = layers;
		},
		dispose() {
			DIORAMA.value = 0;
			target.depthTexture?.dispose();
			target.dispose();
			inked.dispose();
			ink.dispose();
			shift.dispose();
			quad.geometry.dispose();
		},
	};
}
