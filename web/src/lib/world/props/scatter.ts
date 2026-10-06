import { Biome } from '../biome';
import { VILLAGES } from '../names';
import { keyer, unit, type Salt } from '../place/keyed';
import type { Class } from '../placement/types';
import type { Ground, Origin } from '../terrain/ground';
import { forest, FRAME_NEAR, ringAt } from './forest';
import type { PropKind } from './kit';
import type { Placer } from './placer';
import { deg, hashOf, turnBy, walker, type Turn } from './roads';
import { RANK, TILE_M, tileOf, type Candidate } from './tiles';

export type { Turn } from './roads';

/**
 * What stands beside the road, keyed by place (#3076, ADR-0081): a seeded
 * draw per world cell — a tree per 22 m, a herd per 150 m, a rock field per
 * 80 m — and per slot of a stroke — a barn or a hut per 1.3 km, a village
 * site per 200 m, one village per 5 km tile, named by its tile. Every draw
 * asks the place (its ground, its land, its roads) and never this build's
 * extent, and a tile is asked for its own draws only, so the props stream
 * with the ground (#3699) and two routes over one place stand the same
 * props in it (#3226).
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
const TILE_NAME_M = 5000;
const TREES_WITHIN = 700;
const VILLAGE_R = 220;
/** Metres of street a village's hamlets stand along, the street one hamlet spans, and the most a house stands off it past the first 15. */
const VILLAGE_ALONG = 500;
const HAMLET_M = 36;
const VILLAGE_OFF = 20;
/** How far from its site a village's houses can stand: half its street, and their way off it. */
const VILLAGE_REACH = VILLAGE_ALONG / 2 + HAMLET_M / 2 + 15 + VILLAGE_OFF;
/** A barn brings one or two more buildings, this far from it at most, in this many tries. */
const CLUSTER_M = 26;
const FARM_TRIES = 6;
/** A village stands in its fields: no stand frames the road this near its church, so it shows from the approach. */
const FIELDS_M = 600;
/** How far a tree's neighbours stand from it (forest.ts). */
const KIN_M = 7;

/**
 * Where the villages stand (#3076): flat road through meadow, one chance per
 * 200 m of each stroke, and one village per 5 km tile, named by its tile —
 * the flat slot with the lowest key whose roadside is meadow. Flatness is
 * the stroke's own and costs nothing; meadow asks the drawn ground, so it is
 * asked in key order and only until a tile has its village. Asked before
 * anything stands, so the set pieces can dress them (#3077).
 */
export function villageSites(place: Place): Village[] {
	const { salt, ground, biomeAt } = place;
	const [e0, n0] = place.origin ?? [0, 0];
	const house = keyer(salt, 'house');
	const name = keyer(salt, 'name');
	const walks = ground.lines.map(walker);
	const strokes = ground.lines.map((l) => hashOf(l.key));
	type Slot = { key: number; k: number; slot: number };
	const flats = new Map<string, Slot[]>();
	walks.forEach((w, k) => {
		// Steep 10 m steps counted once along the stroke: a slot is flat when its kilometre holds none.
		const steps = Math.floor(w.length / 10) + 1;
		const steep = new Int32Array(steps + 1);
		for (let i = 0; i < steps; i++)
			steep[i + 1] =
				steep[i] +
				(Math.abs(w.at(i * 10 + 10).h - w.at(i * 10).h) > 0.3 ? 1 : 0);
		for (let slot = 0; slot * SITE_M <= w.length; slot++) {
			const s = slot * SITE_M;
			if (s < 500 || s > w.length - 500) continue;
			if (steep[(s + 500) / 10] - steep[(s - 500) / 10] > 0) continue;
			const p = w.at(s);
			const tile = `${Math.floor((e0 + p.x) / TILE_NAME_M)}:${Math.floor((n0 - p.z) / TILE_NAME_M)}`;
			const list = flats.get(tile) ?? [];
			list.push({ key: house(strokes[k], slot, 0), k, slot });
			flats.set(tile, list);
		}
	});
	const meadow = ({ k, slot }: Slot) => {
		const p = walks[k].at(slot * SITE_M);
		return [-1, 1].some(
			(side) =>
				biomeAt(p.x + p.lx * 25 * side, p.z + p.lz * 25 * side) ===
				Biome.Meadow,
		);
	};
	const out: Village[] = [];
	for (const [tile, slots] of [...flats].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	)) {
		const site = slots.sort((a, b) => a.key - b.key).find(meadow);
		if (!site) continue;
		const [ti, tj] = tile.split(':').map(Number);
		const p = walks[site.k].at(site.slot * SITE_M);
		out.push({
			x: p.x,
			z: p.z,
			name: VILLAGES[name(ti, tj) % VILLAGES.length],
			line: site.k,
			s: site.slot * SITE_M,
		});
	}
	return out;
}

/** What one tile of a place might stand beside its roads: the candidates its tile is settled from (tiles.ts). */
export function scatter(place: Place, placer: Placer, villages: Village[]) {
	const { salt, ground, heightAt, biomeAt } = place;
	const origin = place.origin ?? [0, 0];
	const [e0, n0] = origin;
	const tree = keyer(salt, 'tree');
	const prop = keyer(salt, 'prop');
	const house = keyer(salt, 'house');
	const u = (key: number) => unit(key);
	const walks = ground.lines.map(walker);
	const strokes = ground.lines.map((l) => hashOf(l.key));

	/** `kind` as a candidate on (x, z), or null where a gate of its own refuses it. */
	function candidate(
		kind: PropKind,
		cls: Class,
		x: number,
		z: number,
		turn: Turn,
		scale: number,
		rank: number,
	): Candidate<Prop> | null {
		const p = placer.candidate(kind, cls, x, z, turn, scale);
		return p && { p, rank, is: { kind, x, z, base: p.base, turn, scale } };
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
	/** Every cell of `size` metres whose draws can reach `spread` metres into tile (ti, tj), in one order. */
	function cells(
		ti: number,
		tj: number,
		size: number,
		spread: number,
		fn: (i: number, j: number) => void,
	) {
		const [i0, i1] = [ti * TILE_M - spread, (ti + 1) * TILE_M + spread];
		const [j0, j1] = [tj * TILE_M - spread, (tj + 1) * TILE_M + spread];
		for (let j = Math.floor(j0 / size); j <= Math.floor(j1 / size); j++)
			for (let i = Math.floor(i0 / size); i <= Math.floor(i1 / size); i++)
				fn(i, j);
	}

	// Each village: a church first, then houses in a few hamlets along its
	// street, each a handful of roofs close together on one side of the road.
	const villageHouses = new Map<Village, Candidate<Prop>[]>();
	function housesOf(site: Village): Candidate<Prop>[] {
		const done = villageHouses.get(site);
		if (done) return done;
		const out: Candidate<Prop>[] = [];
		const w = walks[site.line];
		const stroke = strokes[site.line];
		const slot = site.s / SITE_M;
		const count = 12 + Math.floor(u(house(stroke, slot, 1)) * 10);
		const hamlets = 3 + Math.floor(u(house(stroke, slot, 2)) * 3);
		for (let t = 0; t < 200 && out.length < count; t++) {
			const r = (c: number) => u(house(stroke, slot, 100 + t * 8 + c));
			const h = Math.floor(r(0) * hamlets);
			const at = (u(house(stroke, slot, 10 + h)) - 0.5) * VILLAGE_ALONG;
			const p = w.at(site.s + at + (r(7) - 0.5) * HAMLET_M);
			const side = u(house(stroke, slot, 20 + h)) < 0.5 ? -1 : 1;
			const off = 15 + r(2) * r(3) * VILLAGE_OFF;
			const x = p.x + p.lx * off * side;
			const z = p.z + p.lz * off * side;
			if (!ground.clearOf(x, z, 13) || biomeAt(x, z) === null) continue;
			const kind: PropKind =
				out.length === 0 ? 'church' : r(4) < 0.15 ? 'barn' : 'house';
			const face = turnBy(
				turnBy(p.along, deg(side > 0 ? -90 : 90)),
				deg(Math.round((r(5) - 0.5) * 14)),
			);
			const c = candidate(
				kind,
				'building',
				x,
				z,
				face,
				1,
				(kind === 'church' ? RANK.church : RANK.house) + r(6),
			);
			if (c) out.push(c);
		}
		villageHouses.set(site, out);
		return out;
	}
	const within = (x: number, z: number, m: number) =>
		villages.some((v) => (v.x - x) * (v.x - x) + (v.z - z) * (v.z - z) < m * m);
	const inVillage = (x: number, z: number) => within(x, z, VILLAGE_R);
	const inFields = (x: number, z: number) => within(x, z, FIELDS_M);

	// A farm on open meadow, huts above the treeline: a chance per 1.3 km of
	// each stroke, and each brings one or two neighbours, never a lone box.
	const farms = walks.flatMap((w, k) => {
		const out: { k: number; slot: number; x: number; z: number; face: Turn }[] =
			[];
		for (let slot = 0; slot * BARN_M <= w.length; slot++) {
			const r = (c: number) => u(house(strokes[k], -1 - slot, c));
			const p = w.at(slot * BARN_M);
			const side = r(0) < 0.5 ? -1 : 1;
			const off = 30 + r(1) * 120;
			out.push({
				k,
				slot,
				x: p.x + p.lx * off * side,
				z: p.z + p.lz * off * side,
				face: turnBy(p.along, deg(Math.floor(r(2) * 35))),
			});
		}
		return out;
	});
	const clusters = new Map<number, Candidate<Prop>[]>();
	function clusterOf(i: number): Candidate<Prop>[] {
		const done = clusters.get(i);
		if (done) return done;
		const f = farms[i];
		const r = (c: number) => u(house(strokes[f.k], -1 - f.slot, c));
		const b = biomeAt(f.x, f.z);
		const out: Candidate<Prop>[] = [];
		const barn =
			ground.clearOf(f.x, f.z, 16) &&
			(b === Biome.Meadow || b === Biome.Alpine) &&
			candidate(
				b === Biome.Meadow ? 'barn' : 'hut',
				'building',
				f.x,
				f.z,
				f.face,
				1,
				RANK.farm + r(3),
			);
		if (barn) {
			const more = 1 + Math.floor(r(7) * 2);
			for (let n = 0; n < FARM_TRIES && out.length < more; n++) {
				const [dx, dz] = ringAt(r(10 + n * 3), r(11 + n * 3), 16, CLUSTER_M);
				const [x, z] = [f.x + dx, f.z + dz];
				if (!ground.clearOf(x, z, 16) || biomeAt(x, z) !== b) continue;
				const face = turnBy(
					f.face,
					deg(Math.round((r(12 + n * 3) - 0.5) * 30)),
				);
				const c = candidate(
					b === Biome.Meadow ? 'house' : 'hut',
					'building',
					x,
					z,
					face,
					1,
					RANK.farm + r(40 + n),
				);
				if (c) out.push(c);
			}
			// A farm that finds no neighbour does not stand alone: the barn goes too.
			if (out.length) out.unshift(barn);
		}
		clusters.set(i, out);
		return out;
	}
	const woods = forest(tree(-1, -1, -1));

	/** Everything tile (ti, tj) might stand, in one order. */
	function tile(ti: number, tj: number): Candidate<Prop>[] {
		const out: Candidate<Prop>[] = [];
		const mine = (x: number, z: number) => {
			const [a, b] = tileOf(x, z, origin);
			return a === ti && b === tj;
		};
		const keep = (c: Candidate<Prop> | null) => {
			if (c && mine(c.is.x, c.is.z)) out.push(c);
		};
		const [mx, mz] = [(ti + 0.5) * TILE_M - e0, n0 - (tj + 0.5) * TILE_M];
		const nearTile = (x: number, z: number, m: number) =>
			Math.abs(x - mx) <= TILE_M / 2 + m && Math.abs(z - mz) <= TILE_M / 2 + m;
		const reach = VILLAGE_REACH + TILE_M;
		for (const v of villages)
			if ((v.x - mx) * (v.x - mx) + (v.z - mz) * (v.z - mz) < reach * reach)
				for (const c of housesOf(v)) keep(c);
		farms.forEach((f, i) => {
			if (nearTile(f.x, f.z, CLUSTER_M + 1))
				for (const c of clusterOf(i)) keep(c);
		});

		// Rocks where the ground is rock or alpine, in fields of four.
		cells(ti, tj, ROCKS_M, 8, (i, j) => {
			if (u(prop(i, j, 2000)) >= ROCKS_P) return;
			const [cx, cz] = jitter(
				i,
				j,
				ROCKS_M,
				u(prop(i, j, 2001)),
				u(prop(i, j, 2002)),
			);
			const d = ground.roadDist(cx, cz);
			if (d < 14 || d > 264) return;
			const b = biomeAt(cx, cz);
			if (b !== Biome.Rock && b !== Biome.Alpine) return;
			for (let k = 0; k < 4; k++) {
				const r = (c: number) => u(prop(i, j, 2010 + k * 4 + c));
				const x = cx + (r(0) - 0.5) * 16;
				const z = cz + (r(1) - 0.5) * 16;
				if (mine(x, z) && ground.clearOf(x, z, 9))
					keep(
						candidate(
							'rock',
							'kit',
							x,
							z,
							deg(Math.floor(r(2) * 360)),
							0.6 + r(3) * 1.6,
							RANK.rock + u(prop(i, j, 2030 + k)),
						),
					);
			}
		});

		// Cows in small herds on meadows and alpine pasture, never on the road's shoulder.
		cells(ti, tj, HERD_M, 15, (i, j) => {
			if (u(prop(i, j, 1000)) >= HERD_P) return;
			const [cx, cz] = jitter(
				i,
				j,
				HERD_M,
				u(prop(i, j, 1001)),
				u(prop(i, j, 1002)),
			);
			const d = ground.roadDist(cx, cz);
			if (d < 35 || d > 155) return;
			const b = biomeAt(cx, cz);
			if (b !== Biome.Meadow && b !== Biome.Alpine) return;
			const herd = 3 + Math.floor(u(prop(i, j, 1003)) * 5);
			for (let k = 0; k < herd; k++) {
				const r = (c: number) => u(prop(i, j, 1010 + k * 3 + c));
				const x = cx + (r(0) - 0.5) * 30;
				const z = cz + (r(1) - 0.5) * 30;
				if (mine(x, z) && ground.clearOf(x, z, 20))
					keep(
						candidate(
							'cow',
							'kit',
							x,
							z,
							deg(Math.floor(r(2) * 360)),
							1,
							RANK.herd + u(prop(i, j, 1040 + k)),
						),
					);
			}
		});

		// Trees: one draw per 22 m cell within 700 m of a road, never in a
		// village — in groups where the stand noise says so, conifers
		// framing the road, a forest edge behind every clearing, a thinner
		// forest out of sight. A tree's neighbours may cross into this tile.
		cells(ti, tj, TREE_M, KIN_M + 1, (i, j) => {
			const [x, z] = jitter(i, j, TREE_M, u(tree(i, j, 1)), u(tree(i, j, 2)));
			if (!nearTile(x, z, KIN_M)) return;
			const b = biomeAt(x, z);
			const far = ground.roadDist(x, z);
			if (b === null || far > TREES_WITHIN || inVillage(x, z)) return;
			const g = woods.groupAt(e0 + x, n0 - z);
			const frame = woods.frames(b, far) && !inFields(x, z);
			if (u(tree(i, j, 0)) >= woods.chance(b, far, frame, g)) return;
			if (far < 140 && !ground.clearOf(x, z, 11)) return;
			const conifer =
				frame || heightAt(x, z) >= 900 || u(tree(i, j, 4)) >= 0.55;
			// Heights vary by the stand, taller in its heart, and by the tree.
			const tall = 0.6 + u(tree(i, j, 3)) * 0.6 + 0.35 * Math.max(0, g);
			const kind = conifer ? 'spruce' : 'broadleaf';
			const turn = deg(Math.floor(u(tree(i, j, 5)) * 360));
			keep(
				candidate(kind, 'kit', x, z, turn, tall, RANK.tree + u(tree(i, j, 6))),
			);
			const more = woods.neighbours(b, far, frame, g, u(tree(i, j, 7)));
			for (let k = 0; k < more; k++) {
				const r = (c: number) => u(tree(i, j, 10 + k * 5 + c));
				const [dx, dz] = ringAt(r(0), r(1), 3.5, KIN_M);
				const [tx, tz] = [x + dx, z + dz];
				if (
					mine(tx, tz) &&
					ground.roadDist(tx, tz) >= FRAME_NEAR - 1 &&
					ground.clearOf(tx, tz, 11) &&
					!inVillage(tx, tz)
				)
					keep(
						candidate(
							kind,
							'kit',
							tx,
							tz,
							deg(Math.floor(r(2) * 360)),
							tall * (0.75 + r(3) * 0.3),
							RANK.tree + r(4),
						),
					);
			}
		});
		return out;
	}

	return { tile };
}
