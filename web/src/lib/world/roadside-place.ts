// Where Diorama 3D's roadside stands (roadside.ts draws it): spruces and
// leafy trees, bushes, cows and people, close by the road. Placement only,
// no art, so it can be tested without a canvas.
//
// Every thing keeps its half width off every road, more on a bend's inside
// (the ground's clearOf), so nothing stands on a road where one runs close
// by another or round a hairpin. It keeps off what the world stands there in
// 3D (houses, signs, benches, fences), and off the next thing. It grows where
// the world's own forest grows: where the stand noise says a group, a forest,
// in a gap a meadow. Where it lands is a function of the road, the world's
// seed and the place, so every screen sees the same things in the same
// places, whichever stretch it built first.
import { at, leftOf } from '$lib/road/along';
import type { Route } from '$lib/road/route';
import { Biome } from './biome';
import { EXAG, yOf } from './geometry';
import { kitSpec, PIECE_MODELS, PROP_KINDS, type KitKind } from './props/kit';
import { tileOf } from './props/tiles';
import { FORMATION } from './terrain/road-profile';
import type { World } from './world';

/** Metres one pixel of the room's art stands for: rider-sprite.ts's SPRITE_M, the riders' scale. */
export const ART_M = 0.05;

export type ArtName = 'spruce' | 'leafy' | 'bush' | 'cow' | 'person';

/** Every piece of art the roadside draws, at whole size in art pixels, in the sheet's order. */
export const ART: readonly { name: ArtName; w: number; h: number }[] = [
	{ name: 'spruce', w: 76, h: 152 },
	{ name: 'spruce', w: 76, h: 136 },
	{ name: 'spruce', w: 76, h: 120 },
	{ name: 'leafy', w: 84, h: 116 },
	{ name: 'leafy', w: 84, h: 104 },
	{ name: 'bush', w: 28, h: 20 },
	{ name: 'cow', w: 52, h: 36 }, // grazing
	{ name: 'cow', w: 52, h: 36 }, // head up
	...[0, 1, 2, 3, 4, 5].map(() => ({ name: 'person' as const, w: 24, h: 36 })),
];
const of = (name: ArtName) =>
	ART.flatMap((a, i) => (a.name === name ? [i] : []));
const SPRUCES = of('spruce');
const LEAFIES = of('leafy');
const BUSH = of('bush')[0];
const COWS = of('cow');
const PEOPLE = of('person');

/** Where a thing stands on the ground, metres round its foot: what nothing else may stand in. */
export const FOOT: Record<ArtName, number> = {
	spruce: 0.6,
	leafy: 0.7,
	bush: 0.5,
	cow: 1.1,
	person: 0.35,
};
/** Which wins where two would stand in each other: people, then cows, trees, bushes. */
const RANK: Record<ArtName, number> = {
	person: 0,
	cow: 1,
	spruce: 2,
	leafy: 3,
	bush: 4,
};

/** Half a thing's width, metres: the most a sprite facing the eye reaches across, toward the road too. */
export const reach = (art: number) => (ART[art].w / 2) * ART_M;

/** The most a cow's feet may differ in height across it: steeper than this it does not graze there. */
export const COW_SLOPE_M = 0.5;

/** The road's stretches the roadside is built in: only those near you stand at a time. */
export const BLOCK_M = 300;
/** How far behind you a stretch is kept: the chase camera looks back this far at most. */
const BEHIND_M = 120;
/** How far ahead the roadside is drawn: past this the haze has it. */
export const REACH_M = 520;
/**
 * The band beside a road the roadside owns: the world's own 3D trees and
 * cows inside it are not drawn in Diorama 3D (stage.ts), so a tree is a
 * sprite or a model for good, and never turns from one into the other.
 */
export const BAND_M = 60;
/** Metres between the steps the roadside is laid out at, along the road. */
const STEP_M = 3;
/** Where a village turns out, either side of its middle. */
const VILLAGE_M = 110;
/** The stand noise above which the road runs through a forest (props/forest.ts: above 0 a group). */
const FOREST_CUT = 0.05;

/** Whether the world's own `kind` at (x, z) is the roadside's in Diorama 3D: a tree or a cow in the band. */
export function spriteOwns(
	world: Pick<World, 'clearOf'>,
	kind: string,
	x: number,
	z: number,
): boolean {
	return (
		(kind === 'spruce' || kind === 'broadleaf' || kind === 'cow') &&
		!world.clearOf(x, z, BAND_M)
	);
}

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

/** A thing as the roadside stands it: on the ground, the ground's normal under it for its shadow. */
export type Spot = {
	x: number;
	y: number;
	z: number;
	art: number;
	flip: boolean;
	normal: [number, number, number];
};

/** A thing that might stand: where, which art, and its key, by which the lower wins where two would touch. */
type Candidate = {
	x: number;
	z: number;
	art: number;
	flip: boolean;
	key: number;
	/** The road's sideways at its step: the way the sprite spans to the eye behind it. */
	lx: number;
	lz: number;
};

/** Something the world stands in 3D that the roadside keeps off: its middle and reach. */
type Obstacle = { x: number; z: number; r: number };

const noise = (n: number) => {
	const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return s - Math.floor(s);
};

const KITS = new Set<string>([...PROP_KINDS, ...PIECE_MODELS]);
/** A 3D thing's reach round its middle: its contact box's corner, or a post's. */
function obstacleOf(kind: string, x: number, z: number, scale = 1): Obstacle {
	if (!KITS.has(kind)) return { x, z, r: 0.6 };
	const s = kitSpec(kind as KitKind);
	return {
		x,
		z,
		r: (Math.hypot(s.hw, s.hd) + Math.hypot(s.cx, s.cz)) * scale,
	};
}

/** The roadside of `route` through `world`: `spots(b)` is what stretch b stands. */
export function roadsidePlacer(route: Route, world: World) {
	const villages = world.villageNames.map((v) => v.d);
	const nearVillage = (d: number) =>
		villages.some((v) => Math.abs(v - d) < VILLAGE_M);
	const last = Math.max(0, Math.ceil(route.length / BLOCK_M) - 1);
	const edge = FORMATION + 0.6;
	const seed = world.seed * 1e-9;
	/** The farthest out the roadside reaches from its road, a foot included: the far forest row's. */
	const OUT = edge + 52 + 2;

	/** Everything stretch b might stand, before anything is refused. */
	function raw(b: number): Candidate[] {
		const out: Candidate[] = [];
		const from = b * BLOCK_M;
		const to = Math.min(route.length, from + BLOCK_M);
		const pick = (list: number[], n: number) =>
			list[Math.floor(noise(n) * list.length)];
		for (let d = from; d < to; d += STEP_M)
			for (const side of [-1, 1]) {
				const p = at(route, d);
				const { lx, lz } = leftOf(p.heading);
				const n = d * 7.13 + side * 3.7 + seed;
				let row = 0;
				const put = (dd: number, off: number, art: number) => {
					const q = dd === d ? p : at(route, Math.min(route.length, dd));
					const l = dd === d ? { lx, lz } : leftOf(q.heading);
					out.push({
						x: q.x + l.lx * side * off,
						z: q.z + l.lz * side * off,
						art,
						flip: noise(dd * 3.1 + side) > 0.5,
						key:
							RANK[ART[art].name] * 1e9 +
							dd * 16 +
							row++ * 2 +
							(side > 0 ? 1 : 0),
						lx: l.lx,
						lz: l.lz,
					});
				};
				if (nearVillage(d)) {
					// The village turns out: a few at the verge, now and then.
					if (noise(n) < 0.16)
						put(d, edge + 0.4 + noise(n + 1) * 2.4, pick(PEOPLE, n + 2));
					continue;
				}
				// The world's stand noise a little way out decides: in a group a forest, in a gap a meadow.
				const forest =
					world.standAt(
						p.x + lx * side * (edge + 8),
						p.z + lz * side * (edge + 8),
					) > FOREST_CUT;
				if (forest) {
					put(
						d,
						edge + 1.5 + noise(n + 1) * 5,
						pick([...SPRUCES, ...SPRUCES, LEAFIES[0]], n + 2),
					);
					put(d, edge + 7 + noise(n + 3) * 16, pick(SPRUCES, n + 4));
					if (noise(n + 5) < 0.6)
						put(d, edge + 22 + noise(n + 6) * 30, pick(SPRUCES, n + 7));
					if (noise(n + 8) < 0.3) put(d, edge + 0.5 + noise(n + 9) * 1.5, BUSH);
				} else {
					if (noise(n) < 0.08)
						put(d, edge + 3 + noise(n + 1) * 22, pick(LEAFIES, n + 2));
					if (noise(n + 3) < 0.1) put(d, edge + 0.6 + noise(n + 4) * 5, BUSH);
					// A herd now and then, near enough to hear the bells.
					if (d % 210 === 0 && noise(Math.floor(d / 70) + side + seed) < 0.6)
						for (let k = 0; k < 3; k++)
							put(
								d + k * 4,
								edge + 6 + noise(n + k) * 14,
								pick(COWS, n + k + 1),
							);
					// And someone out to watch the riders go by.
					if (noise(n + 11) < 0.012)
						put(d, edge + 0.5 + noise(n + 12), pick(PEOPLE, n + 13));
				}
			}
		return out;
	}

	/** The ground stretch b's road runs over: min x, min z, max x, max z, read every 25 m. */
	const boxes = new Map<number, [number, number, number, number]>();
	function box(b: number): [number, number, number, number] {
		const known = boxes.get(b);
		if (known) return known;
		let minX = Infinity;
		let minZ = Infinity;
		let maxX = -Infinity;
		let maxZ = -Infinity;
		const from = b * BLOCK_M;
		const to = Math.min(route.length, from + BLOCK_M);
		for (let d = from; d <= to + 24; d += 25) {
			const p = at(route, Math.min(d, to));
			minX = Math.min(minX, p.x);
			maxX = Math.max(maxX, p.x);
			minZ = Math.min(minZ, p.z);
			maxZ = Math.max(maxZ, p.z);
		}
		const out: [number, number, number, number] = [minX, minZ, maxX, maxZ];
		boxes.set(b, out);
		return out;
	}

	/** What the world stands in 3D round stretch b that the roadside keeps off. */
	function obstacles(b: number): Obstacle[] {
		const [minX, minZ, maxX, maxZ] = box(b);
		const pad = BAND_M + 10;
		const [i0, j0] = tileOf(minX - pad, minZ - pad);
		const [i1, j1] = tileOf(maxX + pad, maxZ + pad);
		const out: Obstacle[] = [];
		for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++)
			for (let j = Math.min(j0, j1); j <= Math.max(j0, j1); j++) {
				const t = world.tile(i, j);
				for (const p of t.props)
					if (!spriteOwns(world, p.kind, p.x, p.z))
						out.push(obstacleOf(p.kind, p.x, p.z, p.scale));
				for (const p of t.pieces) out.push(obstacleOf(p.kind, p.x, p.z));
				for (const s of t.signs) out.push({ x: s.x, z: s.z, r: 0.6 });
			}
		return out;
	}

	const clearOnes = new Map<number, Candidate[]>();
	/** Stretch b's candidates on open ground: off every road, off the world's things, on land that grows them. */
	function clear(b: number): Candidate[] {
		const known = clearOnes.get(b);
		if (known) return known;
		const blocks = obstacles(b);
		const out = raw(b).filter((c) => {
			const name = ART[c.art].name;
			const biome = world.biomeAt(c.x, c.z);
			if (
				biome === null ||
				biome === Biome.Water ||
				biome === Biome.Rock ||
				biome === Biome.Snow
			)
				return false;
			// Above the trees: pasture, bushes and people, no tree.
			if (biome === Biome.Alpine && (name === 'spruce' || name === 'leafy'))
				return false;
			if (!world.clearOf(c.x, c.z, FORMATION + reach(c.art))) return false;
			const foot = FOOT[name];
			return blocks.every(
				(o) => Math.hypot(o.x - c.x, o.z - c.z) >= o.r + foot,
			);
		});
		clearOnes.set(b, out);
		// A ride keeps a few stretches; a long road is not held whole.
		if (clearOnes.size > 12) clearOnes.delete(clearOnes.keys().next().value!);
		return out;
	}

	/**
	 * Every other stretch whose roadside could touch b's: the next ones along
	 * the road, and any leg of it that comes back near, as stacked
	 * switchbacks do, however far along it is.
	 */
	function near(b: number): number[] {
		const [ax, az, bx, bz] = box(b);
		const out: number[] = [];
		for (let k = 0; k <= last; k++) {
			if (k === b) continue;
			const [cx, cz, dx, dz] = box(k);
			if (
				cx - bx < 2 * OUT &&
				ax - dx < 2 * OUT &&
				cz - bz < 2 * OUT &&
				az - dz < 2 * OUT
			)
				out.push(k);
		}
		return out;
	}

	const CELL = 2.5;
	const cellOf = (x: number, z: number) =>
		`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;

	/** What stretch b stands: each thing clear of every other with a lower key, near or across the stretch's ends. */
	function spots(b: number): Spot[] {
		const mine = clear(b);
		const all = [...mine, ...near(b).flatMap(clear)];
		const grid = new Map<string, Candidate[]>();
		for (const c of all) {
			const k = cellOf(c.x, c.z);
			const list = grid.get(k);
			if (list) list.push(c);
			else grid.set(k, [c]);
		}
		const out: Spot[] = [];
		for (const c of mine) {
			const foot = FOOT[ART[c.art].name];
			const ci = Math.floor(c.x / CELL);
			const cj = Math.floor(c.z / CELL);
			let free = true;
			for (let i = ci - 1; free && i <= ci + 1; i++)
				for (let j = cj - 1; free && j <= cj + 1; j++)
					for (const o of grid.get(`${i}:${j}`) ?? [])
						if (
							o.key < c.key &&
							Math.hypot(o.x - c.x, o.z - c.z) < foot + FOOT[ART[o.art].name]
						) {
							free = false;
							break;
						}
			if (!free) continue;
			const spot = onGround(c);
			if (spot) out.push(spot);
		}
		return out;
	}

	/**
	 * Stands a thing on the ground. A cow stands on the lower of its ends
	 * across the eye's view, so neither end floats; one on a steeper bank
	 * than COW_SLOPE_M does not graze there. Anything else stands at its foot.
	 */
	function onGround(c: Candidate): Spot | null {
		const h = world.heightAt(c.x, c.z);
		let ground = h;
		if (ART[c.art].name === 'cow') {
			const half = reach(c.art) * 0.8;
			const a = world.heightAt(c.x + c.lx * half, c.z + c.lz * half);
			const b = world.heightAt(c.x - c.lx * half, c.z - c.lz * half);
			if (Math.max(a, b, h) - Math.min(a, b, h) > COW_SLOPE_M) return null;
			ground = Math.min(a, b, h);
		}
		const e = 0.75;
		const gx =
			((world.heightAt(c.x + e, c.z) - world.heightAt(c.x - e, c.z)) * EXAG) /
			(2 * e);
		const gz =
			((world.heightAt(c.x, c.z + e) - world.heightAt(c.x, c.z - e)) * EXAG) /
			(2 * e);
		const len = Math.hypot(gx, 1, gz);
		return {
			x: c.x,
			y: yOf(route, ground),
			z: c.z,
			art: c.art,
			flip: c.flip,
			normal: [-gx / len, 1 / len, -gz / len],
		};
	}

	return { spots };
}
