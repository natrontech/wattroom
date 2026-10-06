import { at } from '$lib/road/along';
import type { Route } from '$lib/road/route';
import { CHUNK_M } from './place/lattice';
import {
	edgesOf,
	REACH,
	toChunk,
	type ChunkAt,
	type Coverage,
	type Edges,
	type Grid,
	type Level,
} from './terrain-mesh';
import { ROAD_W, rowCount } from './terrain/road-profile';

/**
 * The ride's ground around the eye (#3606): the place's own detail out to
 * REACH.near, one quad a chunk out to REACH.far, asked for nearest first as
 * the rider nears it and let go once it lies 10 % past the far reach, so a
 * chunk on the edge never flickers. Nothing about the route's length reaches
 * it — only where the eye is.
 *
 * Inside the near reach a chunk is drawn at the place's level (placeLevel),
 * whichever way the rider came: the one the props stood on. Only the near
 * ring's edge moves with the eye; a chunk that crosses it, or borders one
 * that did, is asked for again with its new edges and swapped when it comes.
 * Three-free.
 */

/** A chunk as the eye wants it drawn. */
export type GridAsk = { chunk: ChunkAt; level: Level; edges: Edges };
/** Where the grids come from: each chunk asked arrives through `got`, once, now or later. */
export type Grids = {
	ask(asks: readonly GridAsk[]): void;
	dispose(): void;
};
export type GotGrid = (ask: GridAsk, grid: Grid) => void;

/** What draws the held chunks: `add` on an id already drawn replaces it. */
export type GroundSink = {
	add(id: string, chunk: ChunkAt, grid: Grid): void;
	drop(id: string): void;
};

/** A chunk this much past the reach is let go: #3220's hysteresis, as the props' rings have it. */
export const LEAVE = 1.1;

export const chunkId = ([ci, cj]: ChunkAt): string => `${ci}:${cj}`;
const variant = (level: Level, edges: Edges) => `${level}:${edges.join()}`;

export function streamGround(
	open: (got: GotGrid) => Grids,
	place: Coverage,
	reach = REACH,
) {
	const held = new Map<string, { chunk: ChunkAt; key: string; grid: Grid }>();
	/** The variant asked for each chunk and not back yet. */
	const asked = new Map<string, string>();
	let sink: GroundSink | null = null;
	let here: string | null = null;
	let eye: [number, number] | null = null;
	let want: Coverage = () => null;
	const wanted = (c: ChunkAt) => {
		const level = want(...c);
		return level && variant(level, edgesOf(want, ...c));
	};

	const grids = open((a, grid) => {
		const id = chunkId(a.chunk);
		const key = variant(a.level, a.edges);
		if (asked.get(id) === key) asked.delete(id);
		if (wanted(a.chunk) !== key || held.get(id)?.key === key) return;
		held.set(id, { chunk: a.chunk, key, grid });
		sink?.add(id, a.chunk, grid);
	});

	return {
		/**
		 * Brings the ground to an eye at (x, z): nothing to do until it crosses
		 * into another chunk, and then only for the chunks that came within
		 * reach and those by the near reach's edge, whose level may have moved.
		 */
		update(x: number, z: number) {
			const at = `${Math.floor(x / CHUNK_M)}:${Math.floor(z / CHUNK_M)}`;
			if (at === here) return;
			here = at;
			const [px, pz] = eye ?? [Infinity, Infinity];
			eye = [x, z];
			want = (ci, cj) => {
				const d = toChunk(x, z, ci, cj);
				return d <= reach.near ? place(ci, cj) : d <= reach.far ? 'far' : null;
			};
			for (const [id, h] of held)
				if (toChunk(x, z, ...h.chunk) > reach.far * LEAVE) {
					held.delete(id);
					sink?.drop(id);
				}
			// A level moves only across the near reach: a chunk that was, or is, or passed within two of it may be drawn anew.
			const band = (a: number, b: number) =>
				Math.min(a, b) <= reach.near + 2 * CHUNK_M &&
				Math.max(a, b) >= reach.near - 2 * CHUNK_M;
			const asks: (GridAsk & { d: number })[] = [];
			const r = Math.ceil(reach.far / CHUNK_M);
			const ci0 = Math.floor(x / CHUNK_M);
			const cj0 = Math.floor(z / CHUNK_M);
			for (let cj = cj0 - r; cj <= cj0 + r; cj++)
				for (let ci = ci0 - r; ci <= ci0 + r; ci++) {
					const d = toChunk(x, z, ci, cj);
					if (d > reach.far) continue;
					const was = toChunk(px, pz, ci, cj);
					if (was <= reach.far && !band(d, was)) continue;
					const chunk: ChunkAt = [ci, cj];
					const id = chunkId(chunk);
					const level = want(ci, cj)!;
					const edges = edgesOf(want, ci, cj);
					const key = variant(level, edges);
					if (held.get(id)?.key === key || asked.get(id) === key) continue;
					asked.set(id, key);
					asks.push({ chunk, level, edges, d });
				}
			if (asks.length === 0) return;
			grids.ask(
				asks
					.sort((a, b) => a.d - b.d)
					.map(({ chunk, level, edges }) => ({ chunk, level, edges })),
			);
		},
		/** Draws with `next` from now on, starting with everything held. */
		attach(next: GroundSink | null) {
			sink = next;
			if (next) for (const [id, h] of held) next.add(id, h.chunk, h.grid);
		},
		/** The chunks held now, for the tests. */
		held: () => [...held.values()],
		/** Chunks asked for and not back yet: none, once the ground around the eye is whole. */
		pending: () => asked.size,
		dispose() {
			grids.dispose();
			sink = null;
			held.clear();
			asked.clear();
		},
	};
}

export type GroundStream = ReturnType<typeof streamGround>;

/** Rows of the ribbon in one streamed piece: 400 m at 2 m a row. */
const PIECE_ROWS = 200;

/**
 * The ribbon in pieces, each the rows it draws and a circle round it — what
 * a ride draws of its road within the ground's reach, as the ground streams.
 */
export function roadPieces(route: Route, step = 2) {
	const last = rowCount(route, step) - 1;
	const out: { rows: [number, number]; x: number; z: number; r: number }[] = [];
	for (let from = 0; from < last; from += PIECE_ROWS) {
		const to = Math.min(from + PIECE_ROWS, last);
		const mid = at(route, ((from + to) / 2) * step);
		let r = 0;
		// Every tenth row and the last: the ribbon's width covers what a 20 m chord misses.
		for (let k = from; ; k = Math.min(k + 10, to)) {
			const p = at(route, k * step);
			r = Math.max(r, Math.hypot(p.x - mid.x, p.z - mid.z));
			if (k === to) break;
		}
		out.push({ rows: [from, to], x: mid.x, z: mid.z, r: r + ROAD_W });
	}
	return out;
}
