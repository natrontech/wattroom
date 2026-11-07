// What stands close by the road in Diorama 3D, in the cozy room's art:
// spruces and leafy trees, bushes, cows in the meadows and
// people at the verge in the villages. All of it is one sheet and one draw:
// an instanced quad per thing, each upright at its own size (SPRITE_M an art
// pixel, the riders' scale), sharp at any distance (rider-sprite.ts). Where
// each thing stands is a function of the road and the world's seed, so
// every screen on the road sees the same trees in the same places.
import * as THREE from 'three';
import { drawWatcher } from '$lib/lounge/draw-rider';
import { dress } from '$lib/lounge/figures';
import { LOUNGE as C } from '$lib/lounge/palette';
import { disc, rect } from '$lib/lounge/pixel';
import { at, leftOf } from '$lib/road/along';
import type { Route } from '$lib/road/route';
import { Biome } from './biome';
import {
	SPRITE_FRAGMENT,
	SPRITE_LIGHT,
	SPRITE_M,
	SPRITE_SCREEN,
	STEP_GLSL,
	stepped,
} from './rider-sprite';
import { yOf } from './geometry';
import { MOTION } from './pixel';
import { FORMATION } from './terrain/road-profile';
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

/** A Swiss cow from the side, grazing or looking up: white, its patches, a bell. */
function cow(g: Ctx, c: Cell, grazing: boolean) {
	const x = c.x + 4;
	const base = c.y + c.h - 2;
	const bodyY = base - 22;
	for (const lx of [4, 9, 30, 35]) rect(g, x + lx, base - 9, 3, 9, C.paper);
	for (const lx of [4, 9, 30, 35]) rect(g, x + lx, base - 2, 3, 2, C.ink);
	rect(g, x + 2, bodyY, 38, 14, C.paper);
	rect(g, x + 1, bodyY + 2, 40, 10, C.paper);
	rect(g, x + 8, bodyY + 1, 9, 7, C.ink);
	rect(g, x + 24, bodyY + 6, 10, 6, C.ink);
	rect(g, x + 30, bodyY, 6, 4, C.ink);
	rect(g, x + 2, bodyY + 12, 38, 2, C.lilac);
	rect(g, x + 26, base - 9, 5, 3, C.heart);
	rect(g, x + 40, bodyY + 1, 2, 9, C.paper);
	rect(g, x + 41, bodyY + 9, 2, 3, C.ink);
	const hy = grazing ? bodyY + 10 : bodyY - 4;
	rect(g, x - 6, hy, 9, 8, C.paper);
	rect(g, x - 7, hy + 4, 4, 4, C.heart);
	rect(g, x - 4, hy + 2, 2, 2, C.ink);
	rect(g, x - 2, hy - 2, 2, 2, C.amber);
	rect(g, x + 1, hy - 1, 3, 2, C.paper);
	rect(g, x - 2, hy + 8, 3, 3, C.amberDark);
	ink(g, c);
}

/** A person's frames side by side, this far apart: arms down, then a wave's two sways. */
const WAVE_STEP = 28;

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

/** The sheet: each thing once at whole size, then halved twice beside it. */
function sheet() {
	let x = 0;
	let y = 0;
	let row = 0;
	const kinds: Kind[] = [];
	const place = (w: number, h: number, draw: (g: Ctx, c: Cell) => void) => {
		if (x + w > COLS) {
			x = 0;
			y += row;
			row = 0;
		}
		// Even edges, so the half and quarter copies line up with the whole.
		const cell = {
			x,
			y,
			w: w + (w % 4 ? 4 - (w % 4) : 0),
			h: h + (h % 4 ? 4 - (h % 4) : 0),
		};
		x += cell.w + 4;
		row = Math.max(row, cell.h + 4);
		kinds.push({ cell, draw, wave: 0 });
		return kinds.length - 1;
	};
	const spruces = [0, 1, 2].map((i) =>
		place(76, 152 - i * 16, (g, c) => spruce(g, c, i * 31)),
	);
	const leafies = [0, 1].map((i) =>
		place(84, 116 - i * 12, (g, c) => leafy(g, c, i * 17)),
	);
	const bushes = [place(28, 20, bush)];
	const cows = [
		place(52, 34, (g, c) => cow(g, c, true)),
		place(52, 34, (g, c) => cow(g, c, false)),
	];
	// Three frames to a person; the kind is the first, arms down.
	const people = [0, 1, 2, 3, 4, 5].map((i) => {
		const k = place(WAVE_STEP * 2 + 24, 36, (g, c) => person(g, c, i));
		kinds[k] = {
			...kinds[k],
			cell: { ...kinds[k].cell, w: 24 },
			wave: WAVE_STEP,
		};
		return k;
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
	return {
		texture: stepped(canvas, COLS, ROWS),
		kinds,
		spruces,
		leafies,
		bushes,
		cows,
		people,
	};
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

/** How far the roadside is drawn: past this the haze has it. */
const REACH_M = 520;

type Spot = { x: number; y: number; z: number; kind: number; flip: boolean };

/** Where everything stands along the road: a forest here, a meadow with cows there, people at the villages. */
function spots(
	route: Route,
	world: World,
	s: ReturnType<typeof sheet>,
	from: number,
	to: number,
): Spot[] {
	const out: Spot[] = [];
	const edge = FORMATION + 0.6;
	const villages = world.villageNames.map((v) => v.d);
	const nearVillage = (d: number) =>
		villages.some((v) => Math.abs(v - d) < 110);
	const put = (d: number, side: number, off: number, kind: number) => {
		const p = at(route, d);
		const { lx, lz } = leftOf(p.heading);
		const x = p.x + lx * side * off;
		const z = p.z + lz * side * off;
		if (world.biomeAt(x, z) === Biome.Water) return;
		out.push({
			x,
			y: yOf(route, world.heightAt(x, z)),
			z,
			kind,
			flip: noise(d * 3.1 + side) > 0.5,
		});
	};
	const pick = (list: number[], n: number) =>
		list[Math.floor(noise(n) * list.length)];
	for (let d = from; d < to; d += 3) {
		const seg = Math.floor(d / 70);
		const r = noise(seg * 1.37 + world.seed * 1e-9);
		const forest = r < 0.45;
		for (const side of [-1, 1]) {
			const n = d * 7.13 + side * 3.7;
			if (nearVillage(d)) {
				// The village turns out: a few at the verge, now and then.
				if (noise(n) < 0.16)
					put(d, side, edge + 0.4 + noise(n + 1) * 2.4, pick(s.people, n + 2));
				continue;
			}
			if (forest) {
				put(
					d,
					side,
					edge + 1.5 + noise(n + 1) * 5,
					pick([...s.spruces, ...s.spruces, s.leafies[0]], n + 2),
				);
				put(d, side, edge + 7 + noise(n + 3) * 16, pick(s.spruces, n + 4));
				if (noise(n + 5) < 0.6)
					put(d, side, edge + 22 + noise(n + 6) * 30, pick(s.spruces, n + 7));
				if (noise(n + 8) < 0.3)
					put(d, side, edge + 0.5 + noise(n + 9) * 1.5, s.bushes[0]);
			} else {
				if (noise(n) < 0.08)
					put(d, side, edge + 3 + noise(n + 1) * 22, pick(s.leafies, n + 2));
				if (noise(n + 3) < 0.1)
					put(d, side, edge + 0.6 + noise(n + 4) * 5, s.bushes[0]);
				// A herd now and then, near enough to hear the bells.
				if (d % 210 === 0 && noise(seg + side) < 0.6)
					for (let k = 0; k < 3; k++)
						put(
							d + k * 4,
							side,
							edge + 6 + noise(n + k) * 14,
							pick(s.cows, n + k + 1),
						);
				// And someone out to watch the riders go by.
				if (noise(n + 11) < 0.012)
					put(d, side, edge + 0.5 + noise(n + 12), pick(s.people, n + 13));
			}
		}
	}
	return out;
}

/** The road's stretches the roadside is built in: only those near you stand at a time. */
const BLOCK_M = 300;
/** How far behind you a stretch is kept: the chase camera looks back this far at most. */
const BEHIND_M = 120;

/**
 * The stretches a rider `d` along a road `length` long sees, nearest first:
 * a loop's wrap round to its start, a road's end where it lies.
 */
export function stretchesFor(d: number, length: number, loop: boolean) {
	const last = Math.max(0, Math.ceil(length / BLOCK_M) - 1);
	const at = Number.isFinite(d) ? d : 0;
	const here = Math.floor(at / BLOCK_M);
	const lo = Math.floor((at - BEHIND_M) / BLOCK_M);
	const hi = Math.floor((at + REACH_M) / BLOCK_M);
	const out: number[] = [];
	for (let b = here; b <= hi; b++) out.push(b);
	for (let b = here - 1; b >= lo; b--) out.push(b);
	const kept = out.map((b) =>
		loop
			? ((b % (last + 1)) + last + 1) % (last + 1)
			: Math.min(last, Math.max(0, b)),
	);
	return [...new Set(kept)];
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
	const stretches = new Map<number, ReturnType<typeof stretch>>();

	function stretch(b: number) {
		const places = spots(
			route,
			world,
			s,
			b * BLOCK_M,
			Math.min(route.length, (b + 1) * BLOCK_M),
		);
		const geometry = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
		const cells = new Float32Array(places.length * 4);
		const flips = new Float32Array(places.length);
		const waves = new Float32Array(places.length);
		places.forEach((p, i) => {
			const c = s.kinds[p.kind].cell;
			cells.set([c.x, c.y, c.w, c.h], i * 4);
			flips[i] = p.flip ? 1 : 0;
			waves[i] = s.kinds[p.kind].wave;
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
		return {
			count: places.length,
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
		count: () => [...stretches.values()].reduce((n, b) => n + b.count, 0),
		/**
		 * You are `d` along the road: the stretches round you stand, the rest
		 * go. One is built a frame, the nearest first; `all` builds every one
		 * now, for a first frame or a picture.
		 */
		update(d: number, all = false) {
			const want = stretchesFor(d, route.length, !!route.loop);
			for (const [b, held] of stretches)
				if (!want.includes(b)) {
					held.dispose();
					stretches.delete(b);
				}
			for (const b of want) {
				if (stretches.has(b)) continue;
				stretches.set(b, stretch(b));
				if (!all) return;
			}
		},
		dispose() {
			for (const held of stretches.values()) held.dispose();
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
	places.forEach((p, i) => {
		const w = s.kinds[p.kind].cell.w * SPRITE_M * 0.8;
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
