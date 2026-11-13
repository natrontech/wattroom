// What stands close by the road in Diorama 3D, in the cozy room's art:
// spruces and leafy trees, bushes, cows in the meadows and people at the
// verge in the villages. All of it is one sheet: an instanced quad per
// thing, each upright at its own size (SPRITE_M an art pixel, the riders'
// scale), sharp at any distance (rider-sprite.ts), with a patch of shade
// laid on the ground under it. Where each thing stands is roadside-place.ts's.
import * as THREE from 'three';
import { drawWatcher } from '#lib/lounge/draw-rider.ts';
import { dress } from '#lib/lounge/figures.ts';
import { LOUNGE as C } from '#lib/lounge/palette.ts';
import { disc, rect } from '#lib/lounge/pixel.ts';
import type { Route } from '#lib/road/route.ts';
import {
	SPRITE_FRAGMENT,
	SPRITE_LIGHT,
	SPRITE_M,
	SPRITE_SCREEN,
	STEP_GLSL,
	stepped,
} from './rider-sprite';
import { MOTION } from './pixel';
import {
	ART,
	REACH_M,
	roadsidePlacer,
	stretchesFor,
	type Spot,
} from './roadside-place';
import type { World } from './world';

type Ctx = CanvasRenderingContext2D;
type Cell = { x: number; y: number; w: number; h: number };

/** The sheet's whole-size columns and rows; the half and quarter copies sit to the right. */
const COLS = 1024;
const ROWS = 512;

/** Every transparent pixel next to a drawn one becomes ink: the room's one-pixel outline. */
function ink(g: Ctx, { x, y, w, h }: Cell) {
	const img = g.getImageData(x, y, w, h);
	const a = (i: number, j: number) =>
		i >= 0 && j >= 0 && i < w && j < h && img.data[(j * w + i) * 4 + 3] > 128;
	const out = new Uint8ClampedArray(img.data);
	const hex = parseInt(C.ink.slice(1), 16);
	for (let j = 0; j < h; j++)
		for (let i = 0; i < w; i++) {
			if (a(i, j)) continue;
			if (a(i - 1, j) || a(i + 1, j) || a(i, j - 1) || a(i, j + 1)) {
				const o = (j * w + i) * 4;
				out[o] = hex >> 16;
				out[o + 1] = (hex >> 8) & 255;
				out[o + 2] = hex & 255;
				out[o + 3] = 255;
			}
		}
	g.putImageData(new ImageData(out, w, h), x, y);
}

const noise = (n: number) => {
	const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return s - Math.floor(s);
};

/** A spruce in tiers, lit from the right: dark, then its colour, then the light catching each tier's tips. */
function spruce(g: Ctx, c: Cell, seed: number) {
	const cx = c.x + Math.floor(c.w / 2);
	const base = c.y + c.h - 2;
	const tall = c.h - 4;
	rect(g, cx - 2, base - 12, 5, 12, C.woodDark);
	rect(g, cx + 1, base - 12, 1, 12, C.wood);
	const tiers = 7;
	for (let t = 0; t < tiers; t++) {
		const top = base - tall + Math.round((t * (tall - 14)) / tiers);
		const th = Math.round((tall - 8) / tiers) + 8;
		const wide = 5 + Math.round(((t + 1) / tiers) * (c.w / 2 - 6));
		for (let r = 0; r < th; r++) {
			const hw = Math.round((r / th) * wide) + 1;
			const jag = r === th - 1 ? Math.round(noise(seed + t * 7 + r) * 3) : 0;
			rect(g, cx - hw + jag, top + r, hw * 2 + 1 - jag, 1, C.leafDark);
			rect(g, cx, top + r, Math.max(1, Math.round(hw * 0.7)), 1, C.leaf);
			if (r > th - 4) rect(g, cx + hw - 3, top + r, 3, 1, C.leafLight);
		}
	}
	rect(g, cx, base - tall - 2, 1, 4, C.leafDark);
	ink(g, c);
}

/** A leafy tree: a crown of round clumps on a trunk, shade low and left, light high and right. */
function leafy(g: Ctx, c: Cell, seed: number) {
	const cx = c.x + Math.floor(c.w / 2);
	const base = c.y + c.h - 2;
	rect(g, cx - 3, base - 40, 7, 40, C.woodDark);
	rect(g, cx + 1, base - 40, 2, 40, C.wood);
	const r = Math.floor(c.w / 4);
	const clumps = [
		[0, -c.h + r * 2 + 4, r + 2],
		[-r, -c.h + r * 3 + 2, r],
		[r, -c.h + r * 3, r],
		[-r * 0.4, -c.h + r * 4, r + 1],
		[r * 0.6, -c.h + r * 4.2, r - 1],
	];
	for (const [dx, dy, rr] of clumps)
		disc(
			g,
			cx + Math.round(dx),
			base + Math.round(dy),
			Math.round(rr),
			C.leafDark,
		);
	for (const [dx, dy, rr] of clumps)
		disc(
			g,
			cx + Math.round(dx) + 2,
			base + Math.round(dy) - 2,
			Math.round(rr * 0.72),
			C.leaf,
		);
	for (const [dx, dy, rr] of clumps)
		disc(
			g,
			cx + Math.round(dx + rr * 0.35),
			base + Math.round(dy - rr * 0.4),
			Math.round(rr * 0.32),
			C.leafLight,
		);
	for (let i = 0; i < 14; i++)
		rect(
			g,
			cx - r * 2 + Math.floor(noise(seed + i) * r * 4),
			base - c.h + r + Math.floor(noise(seed + i * 3) * r * 3),
			2,
			1,
			C.leafLight,
		);
	ink(g, c);
}

function bush(g: Ctx, c: Cell) {
	const cx = c.x + Math.floor(c.w / 2);
	const base = c.y + c.h - 2;
	for (const [dx, rr] of [
		[-6, 6],
		[5, 7],
		[0, 8],
	])
		disc(g, cx + dx, base - rr, rr, C.leafDark);
	for (const [dx, rr] of [
		[-5, 4],
		[6, 4],
		[1, 5],
	])
		disc(g, cx + dx + 1, base - rr - 3, rr, C.leaf);
	rect(g, cx + 3, base - 13, 3, 1, C.leafLight);
	ink(g, c);
}

/** A cow's coat: its body, its patches and the shade under its belly. The patched white of the lowlands, the brown of the Alps and the black of the Valais. */
const COATS = [
	{ body: C.paper, patch: C.ink, belly: C.lilac },
	{ body: '#a9764f', patch: '#8a5b3a', belly: '#7a4e30' },
	{ body: '#2f2836', patch: '#1b1622', belly: '#15111b' },
] as const;

/** A Swiss cow from the side, grazing or looking up, in one of the coats: its patches, a bell. */
function cow(g: Ctx, c: Cell, grazing: boolean, coat: (typeof COATS)[number]) {
	const x = c.x + 4;
	const base = c.y + c.h - 2;
	const bodyY = base - 22;
	for (const lx of [4, 9, 30, 35]) rect(g, x + lx, base - 9, 3, 9, coat.body);
	for (const lx of [4, 9, 30, 35]) rect(g, x + lx, base - 2, 3, 2, C.ink);
	rect(g, x + 2, bodyY, 38, 14, coat.body);
	rect(g, x + 1, bodyY + 2, 40, 10, coat.body);
	rect(g, x + 8, bodyY + 1, 9, 7, coat.patch);
	rect(g, x + 24, bodyY + 6, 10, 6, coat.patch);
	rect(g, x + 30, bodyY, 6, 4, coat.patch);
	rect(g, x + 2, bodyY + 12, 38, 2, coat.belly);
	rect(g, x + 26, base - 9, 5, 3, C.heart);
	rect(g, x + 40, bodyY + 1, 2, 9, coat.body);
	rect(g, x + 41, bodyY + 9, 2, 3, C.ink);
	const hy = grazing ? bodyY + 10 : bodyY - 4;
	rect(g, x - 6, hy, 9, 8, coat.body);
	rect(g, x - 7, hy + 4, 4, 4, C.heart);
	rect(g, x - 4, hy + 2, 2, 2, coat.body === C.paper ? C.ink : C.paper);
	rect(g, x - 2, hy - 2, 2, 2, C.amber);
	rect(g, x + 1, hy - 1, 3, 2, coat.body);
	rect(g, x - 2, hy + 8, 3, 3, C.amberDark);
	ink(g, c);
}

/** A person's frames side by side, this far apart: arms down, then a wave's two sways. */
const WAVE_STEP = 28;
/** Screen pixels an art pixel takes where a wave still shows: the half copy's threshold (rider-sprite.ts STEP_GLSL). */
const WAVE_PX = 0.45;

/** Someone at the verge, facing the road: the room's watcher, arms down and waving (draw-rider.ts). */
function person(g: Ctx, c: Cell, id: number) {
	const figure = dress({ id: `roadside-${id}`, name: '' });
	[2, 0, 1].forEach((frame, k) => {
		g.save();
		g.translate(c.x + k * WAVE_STEP + 12 - 30, c.y + c.h - 1 - 55);
		drawWatcher(g, figure, frame);
		g.restore();
	});
}

/** `wave`: how far along the sheet a person's waving frames are, 0 for anything that does not wave. */
type Kind = { cell: Cell; draw: (g: Ctx, c: Cell) => void; wave: number };

/** The sheet: every ART at whole size, in its order, then halved twice beside it. */
function sheet() {
	let x = 0;
	let y = 0;
	let row = 0;
	const seen: Record<string, number> = {};
	const draws: Record<string, (g: Ctx, c: Cell, i: number) => void> = {
		spruce: (g, c, i) => spruce(g, c, i * 31),
		leafy: (g, c, i) => leafy(g, c, i * 17),
		bush: (g, c) => bush(g, c),
		cow: (g, c, i) => cow(g, c, i % 2 === 0, COATS[(i >> 1) % COATS.length]),
		person: (g, c, i) => person(g, c, i),
	};
	const kinds: Kind[] = ART.map((art) => {
		const i = (seen[art.name] = (seen[art.name] ?? -1) + 1);
		// Three frames to a person, side by side; the kind is the first, arms down.
		const wave = art.name === 'person' ? WAVE_STEP : 0;
		const w = art.w + wave * 2;
		if (x + w > COLS) {
			x = 0;
			y += row;
			row = 0;
		}
		// Even edges, so the half and quarter copies line up with the whole.
		const cell = {
			x,
			y,
			w: art.w + (art.w % 4 ? 4 - (art.w % 4) : 0),
			h: art.h + (art.h % 4 ? 4 - (art.h % 4) : 0),
		};
		x += cell.w + wave * 2 + 4;
		row = Math.max(row, cell.h + 4);
		return { cell, draw: (g, c) => draws[art.name](g, c, i), wave };
	});
	const canvas = document.createElement('canvas');
	canvas.width = COLS * 1.75;
	canvas.height = ROWS;
	const g = canvas.getContext('2d', { willReadFrequently: true })!;
	for (const k of kinds) {
		g.save();
		g.beginPath();
		g.rect(k.cell.x, k.cell.y, k.cell.w + k.wave * 2, k.cell.h);
		g.clip();
		k.draw(g, k.cell);
		g.restore();
	}
	return { texture: stepped(canvas, COLS, ROWS), kinds };
}

/** Each thing's quad stands where its instance does, at its size, facing the eye; the far ones are not drawn. */
const VERTEX = /* glsl */ `
	attribute vec4 aCell;
	attribute float aFlip;
	attribute float aWave;
	uniform float uTime;
	uniform float uCols;
	uniform float uHalfH;
	uniform float uReach;
	varying vec2 vUv;
	varying float vDepth;
	${STEP_GLSL}
	void main() {
		vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
		float depth = -mv.z;
		float px = ${SPRITE_M.toFixed(3)} * projectionMatrix[1][1] * uHalfH / max(depth, 0.1);
		float d = spriteStep(px);
		mv.xy += (position.xy - vec2(0.5, 0.0)) * aCell.zw * ${SPRITE_M.toFixed(3)};
		float u = aFlip > 0.5 ? 1.0 - position.x : position.x;
		// A person waves now and then: a few seconds in eleven, the arm swaying, each on their own beat.
		vec4 cell = aCell;
		if (aWave > 0.0) {
			vec3 at = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
			float beat = fract(sin(dot(at.xz, vec2(12.9898, 78.233))) * 43758.5453);
			if (fract(uTime / 11.0 + beat) < 0.3)
				cell.x += aWave * (fract(uTime * 2.2 + beat) < 0.5 ? 1.0 : 2.0);
		}
		vUv = vec2(
			spriteLeft(d, uCols) + (cell.x + u * cell.z) / d,
			(cell.y + (1.0 - position.y) * cell.w) / d
		);
		vDepth = depth;
		gl_Position = depth > uReach ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
	}`;

const frustum = new THREE.Frustum();
const viewProjection = new THREE.Matrix4();
const body = new THREE.Sphere(new THREE.Vector3(), 1);

/**
 * One of `wavers` (where each stands) is in `camera`'s view, near enough
 * that an art pixel takes at least WAVE_PX screen pixels on a drawing
 * buffer `halfH` pixels half high. Farther, the sprite is its quarter copy
 * and the arm no pixel of its own. `camera`'s matrices as last drawn.
 */
export function wavesInSight(
	wavers: readonly THREE.Vector3[],
	camera: THREE.PerspectiveCamera,
	halfH: number,
): boolean {
	if (wavers.length === 0) return false;
	const reach =
		(SPRITE_M * camera.projectionMatrix.elements[5] * halfH) / WAVE_PX;
	viewProjection.multiplyMatrices(
		camera.projectionMatrix,
		camera.matrixWorldInverse,
	);
	frustum.setFromProjectionMatrix(viewProjection);
	for (const p of wavers) {
		if (p.distanceToSquared(camera.position) > reach * reach) continue;
		body.center.set(p.x, p.y + 0.9, p.z); // a person's middle, a metre round
		if (frustum.intersectsSphere(body)) return true;
	}
	return false;
}

/**
 * The roadside, built a stretch at a time round where you are (`update`):
 * a long road holds a few stretches, never the whole of it.
 */
export function makeRoadside(route: Route, world: World) {
	const s = sheet();
	const material = new THREE.ShaderMaterial({
		uniforms: {
			uMap: { value: s.texture },
			uSheet: { value: new THREE.Vector2(COLS * 1.75, ROWS) },
			uCols: { value: COLS },
			uHalfH: SPRITE_SCREEN.halfH,
			uReach: { value: REACH_M },
			uTime: MOTION.time,
			uAlpha: { value: 1 },
			uGrey: { value: 0 },
			uLight: SPRITE_LIGHT.light,
			uFog: SPRITE_LIGHT.fog,
			uFogK: SPRITE_LIGHT.fogK,
		},
		vertexShader: VERTEX,
		fragmentShader: SPRITE_FRAGMENT,
		side: THREE.DoubleSide,
	});
	const shade = shadeMaterial();
	const group = new THREE.Group();
	/** Each stretch standing, by its index: what it stands. */
	const stretches = new Map<number, Spot[]>();
	const placer = roadsidePlacer(route, world);
	let drawn: { dispose(): void } | null = null;
	/** Where the people who wave stand, for `waving`. */
	let wavers: THREE.Vector3[] = [];

	/** Everything standing, as one instanced draw and its shade as another, whatever the stretches. */
	function redraw() {
		drawn?.dispose();
		const places = [...stretches.values()].flat();
		wavers = places
			.filter((p) => s.kinds[p.art].wave > 0)
			.map((p) => new THREE.Vector3(p.x, p.y, p.z));
		const geometry = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
		const cells = new Float32Array(places.length * 4);
		const flips = new Float32Array(places.length);
		const waves = new Float32Array(places.length);
		places.forEach((p, i) => {
			const c = s.kinds[p.art].cell;
			cells.set([c.x, c.y, c.w, c.h], i * 4);
			flips[i] = p.flip ? 1 : 0;
			waves[i] = s.kinds[p.art].wave;
		});
		geometry.setAttribute(
			'aCell',
			new THREE.InstancedBufferAttribute(cells, 4),
		);
		geometry.setAttribute(
			'aFlip',
			new THREE.InstancedBufferAttribute(flips, 1),
		);
		geometry.setAttribute(
			'aWave',
			new THREE.InstancedBufferAttribute(waves, 1),
		);
		const mesh = new THREE.InstancedMesh(geometry, material, places.length);
		const m = new THREE.Matrix4();
		places.forEach((p, i) =>
			mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)),
		);
		mesh.frustumCulled = false;
		const shadows = shadowsOf(places, s, shade);
		const held = new THREE.Group().add(shadows.mesh, mesh);
		group.add(held);
		drawn = {
			dispose() {
				group.remove(held);
				mesh.dispose(); // its instances' buffers
				geometry.dispose();
				shadows.dispose();
			},
		};
	}

	return {
		group,
		/** Things standing now. */
		count: () => [...stretches.values()].reduce((n, b) => n + b.length, 0),
		/**
		 * Someone who waves stands in `camera`'s view near enough to see the
		 * arm (wavesInSight). They wave a few seconds in eleven, each on their
		 * own beat (VERTEX), so a frame a second shows the arm jump.
		 */
		waving: (camera: THREE.PerspectiveCamera) =>
			wavesInSight(wavers, camera, SPRITE_SCREEN.halfH.value),
		/**
		 * You are `d` along the road: the stretches round you stand, the rest
		 * go. One is built a frame, the nearest first, once the stage has
		 * settled the tiles it keeps off; `all` builds every one now, for a
		 * first frame or a picture.
		 */
		update(d: number, all = false) {
			const want = stretchesFor(d, route.length, !!route.loop);
			let changed = false;
			for (const b of stretches.keys())
				if (!want.includes(b)) {
					stretches.delete(b);
					changed = true;
				}
			for (const b of want) {
				if (stretches.has(b)) continue;
				// The stage settles a tile a frame (stage.ts); settling them here would be a stall.
				if (!all && !placer.ready(b)) continue;
				stretches.set(b, placer.spots(b));
				changed = true;
				if (!all) break;
			}
			if (changed) redraw();
		},
		dispose() {
			drawn?.dispose();
			stretches.clear();
			material.dispose();
			shade.dispose();
			s.texture.dispose();
		},
	};
}

/** A soft patch of shade on the ground under each thing, so it stands on the land and not over it. */
function shadeMaterial() {
	return new THREE.ShaderMaterial({
		uniforms: {
			uShade: { value: new THREE.Color(C.shade) },
			uReach: { value: REACH_M },
		},
		vertexShader: /* glsl */ `
			varying vec2 vUv;
			varying float vDepth;
			void main() {
				vUv = uv;
				vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
				vDepth = -mv.z;
				gl_Position = projectionMatrix * mv;
			}`,
		fragmentShader: /* glsl */ `
			uniform vec3 uShade;
			uniform float uReach;
			varying vec2 vUv;
			varying float vDepth;
			void main() {
				float r = length(vUv - 0.5) * 2.0;
				float a = (1.0 - smoothstep(0.35, 1.0, r)) * 0.46 * (1.0 - smoothstep(uReach * 0.4, uReach * 0.8, vDepth));
				if (a < 0.01) discard;
				gl_FragColor = vec4(uShade, a);
				#include <colorspace_fragment>
			}`,
		transparent: true,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -2,
		polygonOffsetUnits: -2,
	});
}

function shadowsOf(
	places: Spot[],
	s: ReturnType<typeof sheet>,
	material: THREE.ShaderMaterial,
) {
	const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
	const mesh = new THREE.InstancedMesh(geometry, material, places.length);
	const m = new THREE.Matrix4();
	const scale = new THREE.Vector3();
	const at = new THREE.Vector3();
	const q = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const normal = new THREE.Vector3();
	places.forEach((p, i) => {
		const w = s.kinds[p.art].cell.w * SPRITE_M * 0.8;
		// Laid on the ground's own slope, so no half of it floats over a bank.
		q.setFromUnitVectors(up, normal.set(...p.normal));
		mesh.setMatrixAt(
			i,
			m.compose(at.set(p.x, p.y + 0.05, p.z), q, scale.set(w, 1, w * 0.5)),
		);
	});
	mesh.frustumCulled = false;
	mesh.renderOrder = 1;
	return {
		mesh,
		dispose() {
			mesh.dispose();
			geometry.dispose();
		},
	};
}
