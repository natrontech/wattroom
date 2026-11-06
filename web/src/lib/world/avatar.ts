// Your cozy room self on the road: the room's own figure, drawn from every
// side the camera goes (lounge/draw-rider.ts), never a 3D doll in its colours.
// A sprite stands at the rider's wheels and takes its place on whole pixels of
// the Pixel 3D target: it is never scaled, so one art pixel is always one world
// pixel, however far off. Further away it steps down to a copy half the size,
// and then a quarter, reduced by hand so its colours stay its own.
import * as THREE from 'three';
import {
	CELL_H,
	CELL_W,
	GROUND,
	PEDAL_FRAMES,
	VIEWS,
	drawRider,
	type View,
} from '$lib/lounge/draw-rider';
import { LOUNGE } from '$lib/lounge/palette';
import type { Figure } from '$lib/lounge/scene';
import { BAYER, STEPS, TARGET } from './pixel';

/** The sizes a sprite comes in: whole, a half, a quarter. */
export const STEP_DOWNS = [1, 2, 4] as const;
export type StepDown = (typeof STEP_DOWNS)[number];

/** How tall a rider is, in metres, for how many world pixels that makes. */
const TALL_M = 1.75;
/** Under this many world pixels tall, a rider takes the next size down. */
const WHOLE_FROM = 20;
const HALF_FROM = 9;

/** Which size a rider this many world pixels tall takes. */
export function stepDownFor(tall: number): StepDown {
	return tall >= WHOLE_FROM ? 1 : tall >= HALF_FROM ? 2 : 4;
}

/**
 * How a rider going `heading` looks from a camera `dx`, `dz` away from them
 * (camera to rider): which view, and whether it is mirrored, every view
 * facing left as drawn.
 */
export function seenFrom(
	heading: number,
	dx: number,
	dz: number,
): { view: View; flip: boolean } {
	const fx = Math.sin(heading);
	const fz = Math.cos(heading);
	const along = fx * dx + fz * dz;
	const across = fz * dx - fx * dz;
	const off = Math.abs(Math.atan2(across, along)) / Math.PI;
	const view: View =
		off < 0.14
			? 'back'
			: off < 0.36
				? 'quarter'
				: off < 0.64
					? 'side'
					: off < 0.86
						? 'nose'
						: 'front';
	return { view, flip: across > 0 };
}

/** Which of the stroke's frames a crank angle stands in. */
export function pedalFrame(crank: number): number {
	const turn = crank / (Math.PI * 2);
	return Math.floor((turn - Math.floor(turn)) * PEDAL_FRAMES) % PEDAL_FRAMES;
}

/**
 * RGBA pixels at half the size. Each 2 × 2 block keeps its commonest colour
 * that is not ink, or ink if it holds nothing else: an outline stays one
 * pixel and a colour never becomes a blend of two. A block mostly empty
 * stays empty.
 */
export function halved(
	src: Uint8ClampedArray,
	w: number,
	h: number,
	ink: readonly [number, number, number],
): Uint8ClampedArray<ArrayBuffer> {
	const nw = Math.floor(w / 2);
	const nh = Math.floor(h / 2);
	const out = new Uint8ClampedArray(nw * nh * 4);
	const isInk = (i: number) =>
		src[i] === ink[0] && src[i + 1] === ink[1] && src[i + 2] === ink[2];
	for (let y = 0; y < nh; y++)
		for (let x = 0; x < nw; x++) {
			const counts = new Map<number, number>();
			let solid = -1;
			let filled = 0;
			for (const [ox, oy] of [
				[0, 0],
				[1, 0],
				[0, 1],
				[1, 1],
			]) {
				const i = ((y * 2 + oy) * w + x * 2 + ox) * 4;
				if (src[i + 3] < 128) continue;
				filled++;
				solid = i;
				if (!isInk(i)) counts.set(i, 0);
			}
			if (filled < 2) continue;
			let best = solid;
			if (counts.size) {
				const key = (i: number) =>
					(src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
				const seen = new Map<number, { i: number; n: number }>();
				for (const i of counts.keys()) {
					const k = seen.get(key(i));
					if (k) k.n++;
					else seen.set(key(i), { i, n: 1 });
				}
				let most = 0;
				for (const { i, n } of seen.values())
					if (n > most) {
						most = n;
						best = i;
					}
			}
			const o = (y * nw + x) * 4;
			out[o] = src[best];
			out[o + 1] = src[best + 1];
			out[o + 2] = src[best + 2];
			out[o + 3] = 255;
		}
	return out;
}

const SHEET_W = PEDAL_FRAMES * (CELL_W + CELL_W / 2 + CELL_W / 4);
/** Seated rows, then the same out of the saddle. */
const SHEET_H = VIEWS.length * CELL_H * 2;

/** Where the cell for a view, frame and size starts on a rider's sheet. */
function cellAt(view: number, frame: number, d: StepDown, standing = false) {
	const left = d === 1 ? 0 : PEDAL_FRAMES * (d === 2 ? CELL_W : CELL_W * 1.5);
	return {
		x: left + (frame * CELL_W) / d,
		y: ((view + (standing ? VIEWS.length : 0)) * CELL_H) / d,
		w: Math.floor(CELL_W / d),
		h: Math.floor(CELL_H / d),
	};
}

/** Every view and frame of one rider, at every size. */
export function sheetOf(
	figure: Figure,
	draw: (
		g: CanvasRenderingContext2D,
		view: View,
		frame: number,
		standing: boolean,
	) => void = (g, view, frame, standing) =>
		drawRider(g, figure, view, frame, standing),
): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = SHEET_W;
	canvas.height = SHEET_H;
	const g = canvas.getContext('2d', { willReadFrequently: true })!;
	for (const standing of [false, true])
		VIEWS.forEach((view, i) => {
			const row = i + (standing ? VIEWS.length : 0);
			for (let frame = 0; frame < PEDAL_FRAMES; frame++) {
				g.save();
				g.translate(frame * CELL_W, row * CELL_H);
				g.beginPath();
				g.rect(0, 0, CELL_W, CELL_H);
				g.clip();
				draw(g, view, frame, standing);
				g.restore();
			}
		});
	const hex = parseInt(LOUNGE.ink.slice(1), 16);
	const ink = [hex >> 16, (hex >> 8) & 255, hex & 255] as const;
	const whole = PEDAL_FRAMES * CELL_W;
	const half = halved(
		g.getImageData(0, 0, whole, SHEET_H).data,
		whole,
		SHEET_H,
		ink,
	);
	g.putImageData(new ImageData(half, whole / 2, SHEET_H / 2), whole, 0);
	const quarter = halved(half, whole / 2, SHEET_H / 2, ink);
	g.putImageData(
		new ImageData(quarter, whole / 4, SHEET_H / 4),
		whole * 1.5,
		0,
	);
	const sheet = new THREE.CanvasTexture(canvas);
	sheet.magFilter = sheet.minFilter = THREE.NearestFilter;
	sheet.generateMipmaps = false;
	sheet.flipY = false;
	sheet.colorSpace = THREE.SRGBColorSpace;
	return sheet;
}

// A one-by-one quad from its bottom-left corner: the shader lays it out in world pixels.
const QUAD = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);

const VERTEX = /* glsl */ `
	uniform vec2 uTarget;
	uniform vec4 uCell;
	uniform vec2 uSheet;
	uniform vec2 uFoot;
	uniform float uFlip;
	varying vec2 vUv;
	varying float vDepth;
	void main() {
		vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
		vec4 clip = projectionMatrix * mv;
		// The wheels on a whole world pixel, and so every pixel of the sprite.
		vec2 at = floor((clip.xy / clip.w * 0.5 + 0.5) * uTarget + 0.5);
		at += position.xy * uCell.zw - uFoot;
		vUv = vec2(
			uCell.x + (uFlip > 0.5 ? 1.0 - position.x : position.x) * uCell.z,
			uCell.y + (1.0 - position.y) * uCell.w
		) / uSheet;
		vDepth = -mv.z;
		gl_Position = vec4((at / uTarget * 2.0 - 1.0) * clip.w, clip.z, clip.w);
	}`;

const FRAGMENT = /* glsl */ `
	uniform sampler2D uMap;
	uniform float uAlpha;
	uniform float uGrey;
	uniform float uGhost;
	uniform vec3 uFog;
	uniform float uDensity;
	varying vec2 vUv;
	varying float vDepth;
	${BAYER}
	${STEPS}
	void main() {
		vec4 c = texture2D(uMap, vUv);
		if (c.a < 0.5) discard;
		// Dithered while arriving or leaving, never blended (#3098).
		if (uAlpha < 1.0 && uAlpha <= pixelBayer(gl_FragCoord.xy)) discard;
		// A ghost: every other pixel, paled. Whole pixels are never see-through.
		if (uGhost > 0.5 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) > 0.5) discard;
		vec3 rgb = mix(c.rgb, vec3(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))), uGrey);
		rgb = mix(rgb, vec3(1.0), uGhost * 0.45);
		float fog = pixelFog(1.0 - exp(-pow(uDensity * vDepth, 2.0)));
		gl_FragColor = vec4(mix(rgb, uFog, fog), 1.0);
		#include <colorspace_fragment>
	}`;

export type Avatar = ReturnType<typeof makeAvatar>;

/** A rider's sprite: a mesh for their group, drawn only into Pixel 3D's target. */
export function makeAvatar(sheet: THREE.CanvasTexture, ghost = false) {
	const material = new THREE.ShaderMaterial({
		uniforms: {
			uMap: { value: sheet },
			uTarget: TARGET,
			uCell: { value: new THREE.Vector4() },
			uSheet: { value: new THREE.Vector2(SHEET_W, SHEET_H) },
			uFoot: { value: new THREE.Vector2() },
			uFlip: { value: 0 },
			uAlpha: { value: 1 },
			uGrey: { value: 0 },
			uGhost: { value: ghost ? 1 : 0 },
			uFog: { value: new THREE.Color() },
			uDensity: { value: 0 },
		},
		vertexShader: VERTEX,
		fragmentShader: FRAGMENT,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	const mesh = new THREE.Mesh(QUAD, material);
	mesh.frustumCulled = false;
	mesh.renderOrder = 2;
	let crank = 0;
	let standing = false;
	const at = new THREE.Vector3();
	mesh.onBeforeRender = (_r, scene, camera) => {
		const u = material.uniforms;
		mesh.getWorldPosition(at);
		const dx = at.x - camera.position.x;
		const dz = at.z - camera.position.z;
		const parent = mesh.parent!;
		const { view, flip } = seenFrom(parent.rotation.y, dx, dz);
		const cam = camera as THREE.PerspectiveCamera;
		const depth = Math.max(0.1, at.distanceTo(camera.position));
		const tall =
			(TALL_M * TARGET.value.y) /
			(2 * Math.tan((cam.fov * Math.PI) / 360) * depth);
		const d = stepDownFor(tall);
		const cell = cellAt(VIEWS.indexOf(view), pedalFrame(crank), d, standing);
		u.uCell.value.set(cell.x, cell.y, cell.w, cell.h);
		u.uFoot.value.set(
			Math.floor(cell.w / 2),
			Math.floor((CELL_H - GROUND) / d),
		);
		u.uFlip.value = flip ? 1 : 0;
		const fog = (scene as THREE.Scene).fog;
		if (fog instanceof THREE.FogExp2) {
			u.uFog.value.copy(fog.color);
			u.uDensity.value = fog.density;
		}
		material.uniformsNeedUpdate = true;
	};
	return {
		mesh,
		/** This frame's legs, how much of them shows, and whether their screen has gone. */
		set(angle: number, alpha: number, faded: boolean, stand = false) {
			crank = angle;
			standing = stand;
			material.uniforms.uAlpha.value = alpha;
			material.uniforms.uGrey.value = faded ? 1 : 0;
		},
		dispose() {
			material.dispose();
		},
	};
}
