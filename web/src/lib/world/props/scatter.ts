import { Biome } from '../biome';
import { VILLAGES } from '../names';
import { keyer, unit, type Salt } from '../place/keyed';
import type { Class } from '../placement/types';
import type { Ground, Origin } from '../terrain/ground';
import type { PropKind } from './kit';
import { forest, FRAME_NEAR, ringAt } from './forest';
import { createPlacer, type Placer } from './placer';
import { deg, hashOf, turnBy, walker, type Turn } from './roads';
import { CHUNK_M } from '../place/lattice';
import type { ChunkAt } from '../terrain-mesh';

export type { Turn } from './roads';

/**
 * What stands beside the road, keyed by place (#3076, ADR-0081): a seeded
 * draw per world cell — a tree per 22 m, a herd per 150 m, a rock field per
 * 80 m — and per slot of a stroke — a barn or a hut per 1.3 km, a village
 * site per 200 m, one village per 5 km tile, named by its tile. Every draw
 * asks the place (its ground, its land, its roads) and never this build's
 * extent, and each goes through #3219's gates in one fixed order, so two
 * routes over one place stand the same props in it.
 */

export type Prop = {
	kind: PropKind;
	x: number;
	z: number;
	base: number;
	/** How the model is turned about its up axis: the cosine and sine, never an angle. */
	turn: Turn;
	scale: number;
};

/** A generated village: where it stands, its name, and the stroke and metre its street starts from. */
export type Village = {
	x: number;
	z: number;
	name: string;
	line: number;
	s: number;
};

export type Place = {
	salt: Salt;
	origin?: Origin;
	ground: Ground;
	/** The drawn ground. */
	heightAt: (x: number, z: number) => number;
	/** What grows on the drawn ground; null where none is drawn. */
	biomeAt: (x: number, z: number) => Biome | null;
	/** The chunks the ground is drawn in: which cells are asked, never how they answer. */
	chunks: readonly ChunkAt[];
};

// The lab's densities, per cell rather than per draw along the route: the
// dev loop's 60 herd draws and 400 rock draws over 28.8 km, spread over the
// cells within their bands of the road.
const TREE_M = 22;
const HERD_M = 150;
const HERD_P = 0.2;
const ROCKS_M = 80;
const ROCKS_P = 0.18;
const BARN_M = 1300;
const SITE_M = 200;
const TILE_M = 5000;
const TREES_WITHIN = 700;
const VILLAGE_R = 220;
/** Metres of street a village's hamlets stand along, the street one hamlet spans, and the most a house stands off it past the first 15. */
const VILLAGE_ALONG = 500;
const HAMLET_M = 36;
const VILLAGE_OFF = 20;
/** A building at a barn's slot brings one or two more, this far apart at most, in this many tries. */
const CLUSTER_M = 26;
const FARM_TRIES = 6;
/** Metres of open yard round a building's walls, where no tree stands, and of pasture past them, where none frames the road. */
const YARD_M = 8;
const FIELD_M = 80;

/**
 * Where the villages stand (#3076): flat road through meadow, one chance per
 * 200 m of each stroke, and one village per 5 km tile, named by its tile.
 * Asked before anything stands, so the set pieces can dress them (#3077).
 */
export function villageSites(place: Place): Village[] {
	const { salt, ground, biomeAt } = place;
	const [e0, n0] = place.origin ?? [0, 0];
	const house = keyer(salt, 'house');
	const name = keyer(salt, 'name');
	const walks = ground.lines.map(walker);
	const strokes = ground.lines.map((l) => hashOf(l.key));
	const sites = new Map<
		string,
		{ key: number; k: number; slot: number; x: number; z: number }
	>();
	walks.forEach((w, k) => {
		for (let slot = 0; slot * SITE_M <= w.length; slot++) {
			const s = slot * SITE_M;
			if (s < 500 || s > w.length - 500) continue;
			let flat = true;
			for (let t = s - 500; t < s + 500 && flat; t += 10)
				if (Math.abs(w.at(t + 10).h - w.at(t).h) > 0.3) flat = false;
			if (!flat) continue;
			const p = w.at(s);
			const meadow = [-1, 1].some(
				(side) =>
					biomeAt(p.x + p.lx * 25 * side, p.z + p.lz * 25 * side) ===
					Biome.Meadow,
			);
			if (!meadow) continue;
			const tile = `${Math.floor((e0 + p.x) / TILE_M)}:${Math.floor((n0 - p.z) / TILE_M)}`;
			const key = house(strokes[k], slot, 0);
			const was = sites.get(tile);
			if (!was || key < was.key)
				sites.set(tile, { key, k, slot, x: p.x, z: p.z });
		}
	});
	return [...sites]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([tile, site]) => {
			const [ti, tj] = tile.split(':').map(Number);
			return {
				x: site.x,
				z: site.z,
				name: VILLAGES[name(ti, tj) % VILLAGES.length],
				line: site.k,
				s: site.slot * SITE_M,
			};
		});
}

export function scatter(
	place: Place,
	placer: Placer = createPlacer(place.heightAt, place.ground.lines),
	villages: Village[] = villageSites(place),
): { props: Prop[] } {
	const { salt, ground, heightAt, biomeAt } = place;
	const [e0, n0] = place.origin ?? [0, 0];
	const lines = ground.lines;
	const props: Prop[] = [];
	const tree = keyer(salt, 'tree');
	const prop = keyer(salt, 'prop');
	const house = keyer(salt, 'house');
	const u = (key: number) => unit(key);

	/** Stands a prop if the gates let it, and keeps it. */
	function stand(
		kind: PropKind,
		cls: Class,
		x: number,
		z: number,
		turn: Turn,
		scale = 1,
	): boolean {
		const base = placer.stand(kind, cls, x, z, turn, scale);
		if (base === null) return false;
		props.push({ kind, x, z, base, turn, scale });
		return true;
	}

	/**
	 * Every cell of `size` metres whose centre lies on drawn ground, in one
	 * order: `fn(i, j)` with the key frame's indices.
	 */
	function cells(size: number, fn: (i: number, j: number) => void) {
		const found = new Set<number>();
		const all: [number, number][] = [];
		for (const [ci, cj] of place.chunks) {
			// Centres in [ci·C, (ci+1)·C) along x and [cj·C, (cj+1)·C) along z, local.
			const iA = Math.ceil((e0 + ci * CHUNK_M) / size - 0.5);
			const iB = Math.ceil((e0 + (ci + 1) * CHUNK_M) / size - 0.5);
			const jA = Math.floor((n0 - (cj + 1) * CHUNK_M) / size - 0.5) + 1;
			const jB = Math.floor((n0 - cj * CHUNK_M) / size - 0.5) + 1;
			for (let j = jA; j < jB; j++)
				for (let i = iA; i < iB; i++) {
					const k = i * 1e7 + j;
					if (found.has(k)) continue;
					found.add(k);
					all.push([i, j]);
				}
		}
		all.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
		for (const [i, j] of all) fn(i, j);
	}
	/** A spot jittered within cell (i, j), as local x and z. */
	const jitter = (
		i: number,
		j: number,
		size: number,
		ue: number,
		un: number,
	): [number, number] => [
		(i + 0.5 + (ue - 0.5) * 0.9) * size - e0,
		n0 - (j + 0.5 + (un - 0.5) * 0.9) * size,
	];

	const walks = lines.map(walker);
	const strokes = lines.map((l) => hashOf(l.key));

	// Each village: a church first, then houses in a few hamlets along its
	// street, each a handful of roofs close together on one side of the road.
	for (const site of villages) {
		const w = walks[site.line];
		const stroke = strokes[site.line];
		const slot = site.s / SITE_M;
		const count = 12 + Math.floor(u(house(stroke, slot, 1)) * 10);
		const hamlets = 3 + Math.floor(u(house(stroke, slot, 2)) * 3);
		for (let t = 0, placed = 0; t < 200 && placed < count; t++) {
			const r = (c: number) => u(house(stroke, slot, 100 + t * 8 + c));
			const h = Math.floor(r(0) * hamlets);
			const at = (u(house(stroke, slot, 10 + h)) - 0.5) * VILLAGE_ALONG;
			const p = w.at(site.s + at + (r(6) - 0.5) * HAMLET_M);
			const side = u(house(stroke, slot, 20 + h)) < 0.5 ? -1 : 1;
			const off = 15 + r(2) * r(3) * VILLAGE_OFF;
			const x = p.x + p.lx * off * side;
			const z = p.z + p.lz * off * side;
			if (!ground.clearOf(x, z, 13) || biomeAt(x, z) === null) continue;
			const kind: PropKind =
				placed === 0 ? 'church' : r(4) < 0.15 ? 'barn' : 'house';
			const face = turnBy(
				turnBy(p.along, deg(side > 0 ? -90 : 90)),
				deg(Math.round((r(5) - 0.5) * 14)),
			);
			if (stand(kind, 'building', x, z, face)) placed++;
		}
	}
	const inVillage = (x: number, z: number) =>
		villages.some(
			(v) =>
				(v.x - x) * (v.x - x) + (v.z - z) * (v.z - z) < VILLAGE_R * VILLAGE_R,
		);

	// A farm on open meadow, huts above the treeline: a chance per 1.3 km of
	// each stroke, and each brings one or two neighbours, never a lone box.
	walks.forEach((w, k) => {
		for (let slot = 0; slot * BARN_M <= w.length; slot++) {
			const r = (c: number) => u(house(strokes[k], -1 - slot, c));
			const p = w.at(slot * BARN_M);
			const side = r(0) < 0.5 ? -1 : 1;
			const off = 30 + r(1) * 120;
			const x = p.x + p.lx * off * side;
			const z = p.z + p.lz * off * side;
			const b = biomeAt(x, z);
			if (
				!ground.clearOf(x, z, 16) ||
				(b !== Biome.Meadow && b !== Biome.Alpine)
			)
				continue;
			const face = turnBy(p.along, deg(Math.floor(r(2) * 35)));
			if (!stand(b === Biome.Meadow ? 'barn' : 'hut', 'building', x, z, face))
				continue;
			const more = 1 + Math.floor(r(3) * 2);
			let stood = 0;
			for (let n = 0; n < FARM_TRIES && stood < more; n++) {
				const [dx, dz] = ringAt(r(4 + n * 3), r(5 + n * 3), 16, CLUSTER_M);
				const nx = x + dx;
				const nz = z + dz;
				if (!ground.clearOf(nx, nz, 16) || biomeAt(nx, nz) !== b) continue;
				if (
					stand(
						b === Biome.Meadow ? 'house' : 'hut',
						'building',
						nx,
						nz,
						turnBy(face, deg(Math.round((r(6 + n * 3) - 0.5) * 30))),
					)
				)
					stood++;
			}
			// A farm that found no neighbour does not stand alone: the barn goes too.
			if (stood === 0) {
				props.pop();
				placer.placements.pop();
			}
		}
	});

	// Rocks where the ground is rock or alpine, in fields of four.
	cells(ROCKS_M, (i, j) => {
		if (u(prop(i, j, 2000)) >= ROCKS_P) return;
		const [cx, cz] = jitter(
			i,
			j,
			ROCKS_M,
			u(prop(i, j, 2001)),
			u(prop(i, j, 2002)),
		);
		const d = ground.roadDist(cx, cz);
		const b = biomeAt(cx, cz);
		if (d < 14 || d > 264 || (b !== Biome.Rock && b !== Biome.Alpine)) return;
		for (let k = 0; k < 4; k++) {
			const r = (c: number) => u(prop(i, j, 2010 + k * 4 + c));
			const x = cx + (r(0) - 0.5) * 16;
			const z = cz + (r(1) - 0.5) * 16;
			if (ground.clearOf(x, z, 9))
				stand(
					'rock',
					'kit',
					x,
					z,
					deg(Math.floor(r(2) * 360)),
					0.6 + r(3) * 1.6,
				);
		}
	});

	// Cows in small herds on meadows and alpine pasture, never on the road's shoulder.
	cells(HERD_M, (i, j) => {
		if (u(prop(i, j, 1000)) >= HERD_P) return;
		const [cx, cz] = jitter(
			i,
			j,
			HERD_M,
			u(prop(i, j, 1001)),
			u(prop(i, j, 1002)),
		);
		const d = ground.roadDist(cx, cz);
		const b = biomeAt(cx, cz);
		if (d < 35 || d > 155 || (b !== Biome.Meadow && b !== Biome.Alpine)) return;
		const herd = 3 + Math.floor(u(prop(i, j, 1003)) * 5);
		for (let k = 0; k < herd; k++) {
			const r = (c: number) => u(prop(i, j, 1010 + k * 3 + c));
			const x = cx + (r(0) - 0.5) * 30;
			const z = cz + (r(1) - 0.5) * 30;
			if (ground.clearOf(x, z, 20))
				stand('cow', 'kit', x, z, deg(Math.floor(r(2) * 360)));
		}
	});

	// Trees: one draw per 22 m cell within 700 m of a road, never in a
	// village — in groups where the stand noise says so, conifers framing the
	// road, a forest edge behind every clearing, a thinner forest out of sight.
	const woods = forest(tree(-1, -1, -1));
	// Every building keeps its yard, so no trunk stands at a wall, and its
	// pasture, so the road opens beside a hamlet and the roofs show from it.
	const homes = placer.placements
		.filter((p) => p.cls === 'building')
		.map(({ footprint: f }) => {
			const cx = f.reduce((s, [x]) => s + x, 0) / f.length;
			const cz = f.reduce((s, [, z]) => s + z, 0) / f.length;
			const r = Math.sqrt(
				Math.max(
					...f.map(([x, z]) => (x - cx) * (x - cx) + (z - cz) * (z - cz)),
				),
			);
			return [cx, cz, r] as const;
		});
	const near = (x: number, z: number, past: number) =>
		homes.some(
			([cx, cz, r]) =>
				(x - cx) * (x - cx) + (z - cz) * (z - cz) < (r + past) * (r + past),
		);
	const inYard = (x: number, z: number) => near(x, z, YARD_M);
	cells(TREE_M, (i, j) => {
		const [x, z] = jitter(i, j, TREE_M, u(tree(i, j, 1)), u(tree(i, j, 2)));
		const b = biomeAt(x, z);
		const far = ground.roadDist(x, z);
		if (b === null || far > TREES_WITHIN || inVillage(x, z) || inYard(x, z))
			return;
		const g = woods.groupAt(e0 + x, n0 - z);
		const frame = woods.frames(b, far) && !near(x, z, FIELD_M);
		if (u(tree(i, j, 0)) >= woods.chance(b, far, frame, g)) return;
		if (far < 140 && !ground.clearOf(x, z, 11)) return;
		const conifer = frame || heightAt(x, z) >= 900 || u(tree(i, j, 4)) >= 0.55;
		// Heights vary by the stand, taller in its heart, and by the tree.
		const tall = 0.6 + u(tree(i, j, 3)) * 0.6 + 0.35 * Math.max(0, g);
		const kind = conifer ? 'spruce' : 'broadleaf';
		stand(kind, 'kit', x, z, deg(Math.floor(u(tree(i, j, 5)) * 360)), tall);
		if (!woods.pairs(b, far, frame, g)) return;
		const [dx, dz] = ringAt(u(tree(i, j, 6)), u(tree(i, j, 7)), 3.5, 6.5);
		const tx = x + dx;
		const tz = z + dz;
		if (
			ground.roadDist(tx, tz) >= FRAME_NEAR - 1 &&
			ground.clearOf(tx, tz, 11) &&
			!inVillage(tx, tz) &&
			!inYard(tx, tz)
		)
			stand(
				kind,
				'kit',
				tx,
				tz,
				deg(Math.floor(u(tree(i, j, 8)) * 360)),
				tall * (0.75 + u(tree(i, j, 9)) * 0.3),
			);
	});

	return { props };
}
