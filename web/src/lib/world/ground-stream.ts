import { at } from '$lib/road/along';
import type { Route } from '$lib/road/route';
import { CHUNK_M } from './place/lattice';
import {
	disc,
	GROUND_M,
	toChunk,
	type ChunkAt,
	type Grid,
} from './terrain-mesh';
import { ROAD_W, rowCount } from './terrain/road-profile';

/**
 * The ride's ground around the eye (#3606): every chunk within the ground's
 * reach, asked for nearest first as the rider nears it and let go once it
 * lies 10 % past the reach, so a chunk on the edge never flickers. Nothing
 * about the route's length reaches it — only where the eye is. A chunk's
 * grid is the place's whichever way it is reached (placeLevel), so the
 * stream only ever adds and drops: no chunk changes under the rider and no
 * seam opens between two that were built apart. Three-free.
 */

/** Where the grids come from: each chunk asked arrives through `got`, once, now or later. */
export type Grids = {
	ask(chunks: readonly ChunkAt[]): void;
	dispose(): void;
};
export type GotGrid = (chunk: ChunkAt, grid: Grid | null) => void;

/** What draws the held chunks. */
export type GroundSink = {
	add(id: string, chunk: ChunkAt, grid: Grid): void;
	drop(id: string): void;
};

/** A chunk this much past the reach is let go: #3220's hysteresis, as the props' rings have it. */
export const LEAVE = 1.1;

export const chunkId = ([ci, cj]: ChunkAt): string => `${ci}:${cj}`;

export function streamGround(open: (got: GotGrid) => Grids, reach = GROUND_M) {
	const held = new Map<string, { chunk: ChunkAt; grid: Grid }>();
	const asked = new Set<string>();
	let sink: GroundSink | null = null;
	let here: string | null = null;
	let ex = 0;
	let ez = 0;
	const keeps = ([ci, cj]: ChunkAt) => toChunk(ex, ez, ci, cj) <= reach * LEAVE;

	const grids = open((chunk, grid) => {
		const id = chunkId(chunk);
		asked.delete(id);
		if (!grid || held.has(id) || !keeps(chunk)) return;
		held.set(id, { chunk, grid });
		sink?.add(id, chunk, grid);
	});

	return {
		/** Brings the ground to an eye at (x, z): nothing to do until it crosses into another chunk. */
		update(x: number, z: number) {
			ex = x;
			ez = z;
			const at = `${Math.floor(x / CHUNK_M)}:${Math.floor(z / CHUNK_M)}`;
			if (at === here) return;
			here = at;
			for (const [id, h] of held)
				if (!keeps(h.chunk)) {
					held.delete(id);
					sink?.drop(id);
				}
			const want = disc(x, z, reach).filter((c) => {
				const id = chunkId(c);
				return !held.has(id) && !asked.has(id);
			});
			for (const c of want) asked.add(chunkId(c));
			if (want.length > 0) grids.ask(want);
		},
		/** Draws with `next` from now on, starting with everything held. */
		attach(next: GroundSink | null) {
			sink = next;
			if (next) for (const [id, h] of held) next.add(id, h.chunk, h.grid);
		},
		/** The chunks held now, for the tests. */
		held: () => [...held.values()],
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
