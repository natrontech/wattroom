import type { Placement } from '../placement/types';
import type { Arch, Piece, SetPieces, Sign, Standing } from '../setpieces';
import type { Origin } from '../terrain/ground';
import type { Prop } from './scatter';
import { settle, TILE_M, tileCentre, tileKey, type Candidate } from './tiles';

/** What one tile stands: its props, its set pieces and what O9 counts of them, its boards, and every placement as the gates saw it. */
export type Stood = {
	props: Prop[];
	pieces: Piece[];
	standing: Standing[];
	signs: Sign[];
	arches: Arch[];
	placements: Placement[];
};

type Thing = Prop | Standing;
const isStanding = (t: Thing): t is Standing => 'piece' in t;

/**
 * A place's tiles as they stand (#3699): each settled once, from its own
 * candidates and its eight neighbours', and kept — so a tile costs what its
 * own ground costs, whatever the route's length, and stands the same things
 * whichever tile was asked first.
 */
export function standTiles(
	props: { tile(ti: number, tj: number): Candidate<Prop>[] },
	set: Pick<SetPieces, 'tile' | 'boards'>,
	origin: Origin = [0, 0],
) {
	const candidates = new Map<string, Candidate<Thing>[]>();
	const stood = new Map<string, Stood>();

	function candidatesOf(ti: number, tj: number): Candidate<Thing>[] {
		const id = tileKey(ti, tj);
		let list = candidates.get(id);
		if (!list) {
			list = [...set.tile(ti, tj), ...props.tile(ti, tj)];
			candidates.set(id, list);
		}
		return list;
	}

	/** Tile (ti, tj) as it stands, settled the first time it is asked. */
	function tile(ti: number, tj: number): Stood {
		const id = tileKey(ti, tj);
		const done = stood.get(id);
		if (done) return done;
		const around: Candidate<Thing>[] = [];
		for (let dj = -1; dj <= 1; dj++)
			for (let di = -1; di <= 1; di++)
				around.push(...candidatesOf(ti + di, tj + dj));
		const ok = settle(candidatesOf(ti, tj), around);
		const standing = ok.flatMap((c) => (isStanding(c.is) ? [c.is] : []));
		const out: Stood = {
			props: ok.flatMap((c) => (isStanding(c.is) ? [] : [c.is])),
			pieces: standing.map((s) => s.piece),
			standing,
			...set.boards(ti, tj),
			placements: ok.map((c) => c.p),
		};
		stood.set(id, out);
		return out;
	}

	return {
		tile,
		/** Whether tile (ti, tj) is settled already: the stream's cue for what it can draw without waiting. */
		has: (ti: number, tj: number) => stood.has(tileKey(ti, tj)),
		/** Every tile whose centre lies within `r` metres of (x, z), nearest first. */
		within(x: number, z: number, r: number): [number, number][] {
			const [e0, n0] = origin;
			const reach = Math.ceil(r / TILE_M) + 1;
			const ti0 = Math.floor((e0 + x) / TILE_M);
			const tj0 = Math.floor((n0 - z) / TILE_M);
			const out: { t: [number, number]; d: number }[] = [];
			for (let tj = tj0 - reach; tj <= tj0 + reach; tj++)
				for (let ti = ti0 - reach; ti <= ti0 + reach; ti++) {
					const [cx, cz] = tileCentre(ti, tj, origin);
					const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
					if (d <= r * r) out.push({ t: [ti, tj], d });
				}
			return out
				.sort((a, b) => a.d - b.d || a.t[1] - b.t[1] || a.t[0] - b.t[0])
				.map((o) => o.t);
		},
	};
}

export type StandTiles = ReturnType<typeof standTiles>;
