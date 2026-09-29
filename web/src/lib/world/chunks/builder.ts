import type { Cell } from '../place/lattice';
import type { Keying } from '../place/region';
import { buildChunk, chunkId } from './chunk';
import { openChunkCache, type ChunkCache } from './chunk-cache';
import { indexStroke } from './stroke-index';

/**
 * The world's builder (#3074): chunks come from this device's cache when it
 * has them, from a module Worker when it does not, and from the main thread
 * when no worker will start — so a ride always gets its world, only sooner
 * or later. Callers ask in corridor order (corridor.ts) and draw each chunk
 * as it arrives.
 */

export type ToWorker =
	{ type: 'init'; keying: Keying } | { type: 'build'; chunks: Cell[] };
type FromWorker = { type: 'chunk'; chunk: Cell; words: Uint32Array };

export type Builder = {
	build(
		chunks: readonly Cell[],
		onChunk: (chunk: Cell, words: Uint32Array) => void,
	): Promise<void>;
	dispose(): void;
};

const spawn = (): Worker | null => {
	try {
		return new Worker(new URL('./build.worker.ts', import.meta.url), {
			type: 'module',
		});
	} catch {
		return null;
	}
};

export async function createBuilder(o: {
	keying: Keying;
	/** Names the map data the world is built from: a new snapshot is a new world (ADR-0081). */
	snapshot: string;
	cache?: ChunkCache;
	worker?: () => Worker | null;
}): Promise<Builder> {
	const cache = o.cache ?? (await openChunkCache());
	let worker = typeof Worker === 'undefined' ? null : (o.worker ?? spawn)();
	let index: ReturnType<typeof indexStroke> | null = null;
	worker?.postMessage({ type: 'init', keying: o.keying } satisfies ToWorker);
	worker?.addEventListener('error', () => {
		console.warn('world: the build worker stopped; building on the page');
		worker?.terminate();
		worker = null;
	});

	/** On this thread, a chunk at a time, letting a frame through between them. */
	async function here(chunks: Cell[], got: (c: Cell, w: Uint32Array) => void) {
		index ??= indexStroke(o.keying.stroke);
		for (const chunk of chunks) {
			got(chunk, buildChunk(chunk, o.keying, index));
			await new Promise((r) => setTimeout(r, 0));
		}
	}

	return {
		async build(chunks, onChunk) {
			const got = (chunk: Cell, words: Uint32Array) => {
				onChunk(chunk, words);
				void cache.put(chunkId(o.snapshot, chunk), words);
			};
			const missing: Cell[] = [];
			for (const chunk of chunks) {
				const kept = await cache.get(chunkId(o.snapshot, chunk));
				if (kept) onChunk(chunk, kept);
				else missing.push(chunk);
			}
			if (missing.length === 0) return;
			const w = worker;
			if (!w) return here(missing, got);
			await new Promise<void>((resolve) => {
				let left = missing.length;
				const want = new Set(missing.map((c) => `${c.i}:${c.j}`));
				const onMessage = (e: MessageEvent<FromWorker>) => {
					const { chunk, words } = e.data;
					if (!want.delete(`${chunk.i}:${chunk.j}`)) return;
					got(chunk, words);
					if (--left === 0) finish();
				};
				// A worker that dies mid-way hands what is left to the page.
				const onError = () => {
					finish();
					void here(
						missing.filter((c) => want.has(`${c.i}:${c.j}`)),
						got,
					).then(resolve);
				};
				const finish = () => {
					w.removeEventListener('message', onMessage);
					w.removeEventListener('error', onError);
					if (left === 0) resolve();
				};
				w.addEventListener('message', onMessage);
				w.addEventListener('error', onError);
				w.postMessage({ type: 'build', chunks: missing } satisfies ToWorker);
			});
		},
		dispose() {
			worker?.terminate();
			worker = null;
		},
	};
}
