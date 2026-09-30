import type { GotGrid, GridAsk, Grids } from '../ground-stream';
import type { Salt } from '../place/keyed';
import {
	edgesOf,
	type Coverage,
	type Edges,
	type Grid,
	type Level,
} from '../terrain-mesh';
import type { Line } from '../terrain/lines';
import { spawn } from './builder';

/**
 * Where a streamed chunk's ground comes from (#3606): the page's own copy
 * when the world already built it just so — the props stood on it — else
 * the build worker, else this thread a chunk at a time with a frame between
 * them, when no worker will start or one stops. Every one of them is the
 * same grid: the worker builds the page's ground from the same roads and
 * salt.
 */

export type ToGroundWorker =
	| { type: 'ground'; roads: Line[]; salt: Salt }
	| { type: 'grids'; asks: GridAsk[] };
export type FromGroundWorker = { type: 'grid'; ask: GridAsk; grid: Grid };

type Place = {
	roads: Line[];
	salt: Salt;
	/** How finely the place draws each chunk: what the world built and kept. */
	level: Coverage;
	/** A chunk's grid at the place's level, built on this thread and kept. */
	grid: (ci: number, cj: number) => Grid | null;
	/** That, if this thread has built it already. */
	peek: (ci: number, cj: number) => Grid | null | undefined;
	/** Any chunk's grid, built on this thread and not kept. */
	gridAt: (ci: number, cj: number, level: Level, edges: Edges) => Grid;
};

/** Whether `a` is the chunk as the place draws it: what the world built for its props. */
function placed(place: Place, a: GridAsk) {
	const [ci, cj] = a.chunk;
	return (
		place.level(ci, cj) === a.level &&
		edgesOf(place.level, ci, cj).every((e, k) => e === a.edges[k])
	);
}

/** `a`'s grid, built on this thread: the world's kept copy when it is one. */
const onPage = (place: Place, a: GridAsk): Grid =>
	placed(place, a)
		? place.grid(...a.chunk)!
		: place.gridAt(...a.chunk, a.level, a.edges);

export function placeGrids(
	place: Place,
	got: GotGrid,
	worker: () => Worker | null = spawn,
): Grids {
	let w = worker(); // null where no worker will start: spawn() catches that
	let stopped = false;
	/** Asked of the worker and not back yet: what this thread builds if it stops. */
	const out = new Map<string, GridAsk>();
	const id = (a: GridAsk) =>
		`${a.chunk.join(':')}:${a.level}:${a.edges.join()}`;

	async function here(asks: readonly GridAsk[]) {
		for (const a of asks) {
			if (stopped) return;
			got(a, onPage(place, a));
			await new Promise((r) => setTimeout(r, 0));
		}
	}

	if (w) {
		w.addEventListener('message', (e: MessageEvent<FromGroundWorker>) => {
			if (e.data.type !== 'grid') return;
			out.delete(id(e.data.ask));
			if (!stopped) got(e.data.ask, e.data.grid);
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
		ask(asks) {
			const rest: GridAsk[] = [];
			for (const a of asks) {
				const kept = placed(place, a) && place.peek(...a.chunk);
				if (kept) got(a, kept);
				else rest.push(a);
			}
			if (rest.length === 0) return;
			if (!w) return void here(rest);
			for (const a of rest) out.set(id(a), a);
			w.postMessage({ type: 'grids', asks: rest } satisfies ToGroundWorker);
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
	(place: Place) =>
	(got: GotGrid): Grids => ({
		ask: (asks) => asks.forEach((a) => got(a, onPage(place, a))),
		dispose() {},
	});
