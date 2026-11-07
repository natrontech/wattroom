// The room's art in Diorama 3D: riders, people, cows and trees as the cozy
// room draws them, standing in the world at its own size. One scale for all
// of it (SPRITE_M a pixel of art), so a cow is a cow beside a rider. A
// sprite grows and shrinks with the distance like everything else in the
// world, and its pixels stay square and sharp at any size: the texture is
// sampled so each art pixel keeps a hard edge one screen pixel wide. Far
// off it reads a half or a quarter copy reduced by hand (avatar.ts), so its
// colours stay its own. Riders get nine turns from behind round to the
// front and the room's eight frames a pedal stroke, so a bend turns them a
// little at a time and their legs run. A sheet is drawn a row a frame.
import * as THREE from 'three';
import {
	CELL_H,
	CELL_W,
	GROUND,
	VIEWS,
	drawCyclist,
	type View,
	YAW,
} from '$lib/lounge/draw-rider';
import { LOUNGE } from '$lib/lounge/palette';
import type { Figure } from '$lib/lounge/scene';
import { halved } from './avatar';
import { BAYER } from './pixel';

/** Metres one pixel of the room's art stands for: a person 31 pixels tall is 1.55 m. */
export const SPRITE_M = 0.05;
/** The turns drawn, degrees from straight behind. */
export const TURNS = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180] as const;
/** Frames to a pedal stroke: the room's eighths. */
// ponytail: 8 keeps a sheet at 3.6 MB; 16 doubles it for half steps, if legs ever look choppy.
export const FRAMES = 8;

/** The light every sprite takes, and the haze it fades into: set from the look (scene.ts). */
export const SPRITE_LIGHT = {
	light: { value: new THREE.Color(1, 1, 1) },
	fog: { value: new THREE.Color(1, 1, 1) },
	fogK: { value: 0 },
};

/** The named view nearest a turn: the head is drawn for one of those. */
function nearestView(deg: number): View {
	let best: View = 'back';
	for (const v of VIEWS)
		if (Math.abs(YAW[v] - deg) < Math.abs(YAW[best] - deg)) best = v;
	return best;
}

/** Which turn a rider going `heading` shows a camera `dx`, `dz` from them, and whether it is mirrored. */
export function turnFrom(heading: number, dx: number, dz: number) {
	const fx = Math.sin(heading);
	const fz = Math.cos(heading);
	const along = fx * dx + fz * dz;
	const across = fz * dx - fx * dz;
	const off = Math.abs(Math.atan2(across, along)) / Math.PI;
	return { turn: Math.round(off * (TURNS.length - 1)), flip: across > 0 };
}

/** The room's ink as RGB, which the reduced copies keep their outlines in. */
const inkRgb = () => {
	const hex = parseInt(LOUNGE.ink.slice(1), 16);
	return [hex >> 16, (hex >> 8) & 255, hex & 255] as const;
};

/**
 * The band of art `y` to `y + h` at whole size, reduced to a half and a
 * quarter copy beside it: the whole size takes `w` columns, the half starts
 * at `w`, the quarter at 1.5 `w`.
 */
function reduce(g: CanvasRenderingContext2D, w: number, y: number, h: number) {
	const half = halved(g.getImageData(0, y, w, h).data, w, h, inkRgb());
	g.putImageData(new ImageData(half, w / 2, h / 2), w, y / 2);
	const quarter = halved(half, w / 2, h / 2, inkRgb());
	g.putImageData(new ImageData(quarter, w / 4, h / 4), w * 1.5, y / 4);
}

function sheetTexture(canvas: HTMLCanvasElement) {
	const tex = new THREE.CanvasTexture(canvas);
	// Linear, for the sharp-pixel sampling below; never mipmapped, the copies are the mips.
	tex.magFilter = tex.minFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	tex.flipY = false;
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

/** Art `w` × `h` at whole size, with its half and quarter copies beside it, as a texture. */
export function stepped(canvas: HTMLCanvasElement, w: number, h: number) {
	reduce(canvas.getContext('2d', { willReadFrequently: true })!, w, 0, h);
	return sheetTexture(canvas);
}

const SHEET_COLS = FRAMES * CELL_W;
const SHEET_W = SHEET_COLS * 1.75;
const SHEET_H = TURNS.length * CELL_H * 2;
/** Rows of a sheet: each turn seated, then each standing. */
const ROWS = TURNS.length * 2;
/** Rows drawn before a sheet first goes up: from behind and a little round, what the chase camera sees. */
const FIRST_UP = 3;

/** Sheets still to draw, a row at a time: each job says when it is done. */
const jobs: (() => boolean)[] = [];

/**
 * Draws the sheets waiting, for `ms` of this frame: a rider's sheet is too
 * much for one frame on a phone. Infinity draws them all, for a picture.
 */
export function drawSheets(ms = 3) {
	const until = performance.now() + ms;
	while (jobs.length && performance.now() < until) if (jobs[0]()) jobs.shift();
}

export type RiderSheet = {
	texture: THREE.CanvasTexture;
	/** Turns up on the GPU, seated and standing: a sprite shows the nearest of them. */
	up: { seated: number; standing: number };
	dispose(): void;
};

/**
 * Every turn and frame of one rider, seated and standing, at every size.
 * Drawn a row at a time by drawSheets: up once the back turns are there,
 * again once seated is whole, and once all is.
 */
export function riderSheet(figure: Figure): RiderSheet {
	const canvas = document.createElement('canvas');
	canvas.width = SHEET_W;
	canvas.height = SHEET_H;
	const g = canvas.getContext('2d', { willReadFrequently: true })!;
	const texture = sheetTexture(canvas);
	const up = { seated: 0, standing: 0 };
	let row = 0;
	let gone = false;
	jobs.push(() => {
		if (gone) return true;
		const standing = row >= TURNS.length;
		const deg = TURNS[row % TURNS.length];
		for (let frame = 0; frame < FRAMES; frame++) {
			g.save();
			g.translate(frame * CELL_W, row * CELL_H);
			g.beginPath();
			g.rect(0, 0, CELL_W, CELL_H);
			g.clip();
			drawCyclist(
				g,
				figure,
				nearestView(deg),
				(frame / FRAMES) * 8,
				CELL_W / 2,
				GROUND,
				{ shadow: true, standing, yaw: deg },
			);
			g.restore();
		}
		reduce(g, SHEET_COLS, row * CELL_H, CELL_H);
		row++;
		if (row === FIRST_UP || row === TURNS.length || row === ROWS) {
			texture.needsUpdate = true;
			up.seated = Math.min(row, TURNS.length);
			up.standing = Math.max(0, row - TURNS.length);
		}
		return row === ROWS;
	});
	return {
		texture,
		up,
		dispose() {
			gone = true;
			texture.dispose();
		},
	};
}

/** Which copy a sprite reads at this many screen pixels an art pixel: whole, half, quarter. */
export const STEP_GLSL = /* glsl */ `
	float spriteStep(float px) { return px >= 0.9 ? 1.0 : px >= 0.45 ? 2.0 : 4.0; }
	float spriteLeft(float d, float cols) { return d < 1.5 ? 0.0 : d < 3.0 ? cols : cols * 1.5; }`;

/**
 * Upright in the world at its size, facing the eye. `cell` is the art's
 * rectangle at whole size and `foot` where it stands in it, in art pixels.
 */
export const SPRITE_VERTEX = /* glsl */ `
	uniform vec2 uSheet;
	uniform float uCols;
	uniform float uHalfH;
	uniform vec4 uCell;
	uniform vec2 uFoot;
	uniform float uFlip;
	varying vec2 vUv;
	varying float vDepth;
	${STEP_GLSL}
	void main() {
		vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
		// Screen pixels one art pixel takes here: half the drawing buffer's height over the eye's reach.
		float px = ${SPRITE_M.toFixed(3)} * projectionMatrix[1][1] * uHalfH / max(-mv.z, 0.1);
		float d = spriteStep(px);
		mv.xy += (position.xy * uCell.zw - uFoot) * ${SPRITE_M.toFixed(3)};
		float u = uFlip > 0.5 ? 1.0 - position.x : position.x;
		vUv = vec2(
			spriteLeft(d, uCols) + (uCell.x + u * uCell.z) / d,
			(uCell.y + (1.0 - position.y) * uCell.w) / d
		);
		vDepth = -mv.z;
		gl_Position = projectionMatrix * mv;
	}`;

/** Square pixels at any size, under the world's light and into its haze. */
export const SPRITE_FRAGMENT = /* glsl */ `
	uniform sampler2D uMap;
	uniform vec2 uSheet;
	uniform float uAlpha;
	uniform float uGrey;
	uniform vec3 uLight;
	uniform vec3 uFog;
	uniform float uFogK;
	varying vec2 vUv;
	varying float vDepth;
	${BAYER}
	void main() {
		// Each art pixel flat, its edge one screen pixel of blend: sharp, never shimmering.
		vec2 seam = floor(vUv + 0.5);
		vec2 uv = seam + clamp((vUv - seam) / max(fwidth(vUv), vec2(1e-4)), -0.5, 0.5);
		vec4 c = texture2D(uMap, uv / uSheet);
		if (c.a < 0.5) discard;
		if (uAlpha < 1.0 && uAlpha <= pixelBayer(gl_FragCoord.xy / 2.0)) discard;
		vec3 rgb = mix(c.rgb, vec3(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))), uGrey);
		rgb *= uLight;
		float fog = 1.0 - exp(-vDepth * uFogK);
		#ifdef GHOST_OPACITY
			// A ghost (ghosts.ts): paler, and see-through rather than dithered.
			rgb = mix(rgb, vec3(1.0), GHOST_PALE);
			gl_FragColor = vec4(mix(rgb, uFog, clamp(fog, 0.0, 1.0)), GHOST_OPACITY);
		#else
			gl_FragColor = vec4(mix(rgb, uFog, clamp(fog, 0.0, 1.0)), 1.0);
		#endif
		#include <colorspace_fragment>
	}`;

/** The drawing buffer's height in its own pixels, halved: what a sprite's size on screen is worked out from. */
export const SPRITE_SCREEN = { halfH: { value: 450 } };

const QUAD = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);

export type RiderSprite = ReturnType<typeof makeRiderSprite>;

/** A rider's sprite in Diorama 3D: the same calls as avatar.ts's, so crew.ts can hold either. */
export function makeRiderSprite(
	sheet: RiderSheet,
	ghost?: { opacity: number; pale: number },
) {
	const material = new THREE.ShaderMaterial({
		uniforms: {
			uMap: { value: sheet.texture },
			uSheet: { value: new THREE.Vector2(SHEET_W, SHEET_H) },
			uCols: { value: SHEET_COLS },
			uHalfH: SPRITE_SCREEN.halfH,
			uCell: { value: new THREE.Vector4() },
			uFoot: { value: new THREE.Vector2(CELL_W / 2, CELL_H - GROUND) },
			uFlip: { value: 0 },
			uAlpha: { value: 1 },
			uGrey: { value: 0 },
			uLight: SPRITE_LIGHT.light,
			uFog: SPRITE_LIGHT.fog,
			uFogK: SPRITE_LIGHT.fogK,
		},
		vertexShader: SPRITE_VERTEX,
		fragmentShader: SPRITE_FRAGMENT,
		side: THREE.DoubleSide,
		...(ghost && {
			defines: {
				GHOST_OPACITY: ghost.opacity.toFixed(2),
				GHOST_PALE: ghost.pale.toFixed(2),
			},
			transparent: true,
			depthWrite: false,
		}),
	});
	const mesh = new THREE.Mesh(QUAD, material);
	mesh.frustumCulled = false;
	// After the road's see-through marks, as the 3D ghost is.
	if (ghost) mesh.renderOrder = 1;
	let crank = 0;
	let standing = false;
	const at = new THREE.Vector3();
	mesh.onBeforeRender = (_r, _scene, camera) => {
		const u = material.uniforms;
		// Nothing up yet: no quad at all, until the sheet's first rows are.
		if (!sheet.up.seated) {
			u.uCell.value.set(0, 0, 0, 0);
			material.uniformsNeedUpdate = true;
			return;
		}
		mesh.getWorldPosition(at);
		const { turn, flip } = turnFrom(
			mesh.parent!.rotation.y,
			at.x - camera.position.x,
			at.z - camera.position.z,
		);
		const t = crank / (Math.PI * 2);
		const frame = Math.floor((t - Math.floor(t)) * FRAMES) % FRAMES;
		// A sheet still being drawn shows the nearest turn it has, seated until standing is up.
		const stand = standing && sheet.up.standing > 0;
		const shown = Math.min(
			turn,
			(stand ? sheet.up.standing : sheet.up.seated) - 1,
		);
		const row = shown + (stand ? TURNS.length : 0);
		u.uCell.value.set(frame * CELL_W, row * CELL_H, CELL_W, CELL_H);
		u.uFlip.value = flip ? 1 : 0;
		material.uniformsNeedUpdate = true;
	};
	return {
		mesh,
		set(angle: number, alpha: number, faded: boolean, stand = false) {
			crank = angle;
			standing = stand;
			material.uniforms.uAlpha.value = alpha;
			material.uniforms.uGrey.value = faded ? 1 : 0;
		},
		dispose() {
			sheet.dispose();
			material.dispose();
		},
	};
}
