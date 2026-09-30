import type { GotGrid, Grids } from '../ground-stream';
import type { Salt } from '../place/keyed';
import type { ChunkAt, Grid } from '../terrain-mesh';
import type { Line } from '../terrain/lines';
import { spawn } from './builder';

/**
 * Where a streamed chunk's ground comes from (#3606): the page's own copy
 * when the world already built it — the props stood on it — else the build
 * worker, else this thread a chunk at a time with a frame between them, when
 * no worker will start or one stops. Every one of them is the same grid: the
 * worker builds the page's ground from the same roads and salt.
 */

export type ToGroundWorker =
	| { type: 'ground'; roads: Line[]; salt: Salt }
	| { type: 'grids'; chunks: ChunkAt[] };
export type FromGroundWorker = {
	type: 'grid';
	chunk: ChunkAt;
	grid: Grid | null;
};

type Place = {
	roads: Line[];
	salt: Salt;
	/** A chunk's grid, built on this thread. */
	grid: (ci: number, cj: number) => Grid | null;
	/** A chunk's grid if this thread has built it already. */
	peek: (ci: number, cj: number) => Grid | null | undefined;
};

export function placeGrids(
	place: Place,
	got: GotGrid,
	worker: () => Worker | null = spawn,
): Grids {
	let w = worker(); // null where no worker will start: spawn() catches that
	let stopped = false;
	/** Asked of the worker and not back yet: what this thread builds if it stops. */
	const out = new Map<string, ChunkAt>();
	const id = ([ci, cj]: ChunkAt) => `${ci}:${cj}`;

	async function here(chunks: readonly ChunkAt[]) {
		for (const c of chunks) {
			if (stopped) return;
			got(c, place.grid(c[0], c[1]));
			await new Promise((r) => setTimeout(r, 0));
		}
	}

	if (w) {
		w.addEventListener('message', (e: MessageEvent<FromGroundWorker>) => {
			if (e.data.type !== 'grid') return;
			out.delete(id(e.data.chunk));
			if (!stopped) got(e.data.chunk, e.data.grid);
		});
		w.addEventListener('error', () => {
			console.warn('world: the ground worker stopped; building on the page');
			w?.terminate();
			w = null;
			const left = [...out.values()];
			out.clear();
			void here(left);
		});
		w.postMessage({
			type: 'ground',
			roads: place.roads,
			salt: place.salt,
		} satisfies ToGroundWorker);
	}

	return {
		ask(chunks) {
			const rest: ChunkAt[] = [];
			for (const c of chunks) {
				const kept = place.peek(c[0], c[1]);
				if (kept !== undefined) got(c, kept);
				else rest.push(c);
			}
			if (rest.length === 0) return;
			if (!w) return void here(rest);
			for (const c of rest) out.set(id(c), c);
			w.postMessage({ type: 'grids', chunks: rest } satisfies ToGroundWorker);
		},
		dispose() {
			stopped = true;
			w?.terminate();
			w = null;
			out.clear();
		},
	};
}

/** Every chunk built at once, on this thread: what the scene budget and the tests draw. */
export const pageGrids =
	(place: Pick<Place, 'grid'>) =>
	(got: GotGrid): Grids => ({
		ask: (chunks) => chunks.forEach((c) => got(c, place.grid(c[0], c[1]))),
		dispose() {},
	});
