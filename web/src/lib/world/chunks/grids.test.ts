import { beforeAll, describe, expect, it } from 'vitest';
import type { GridAsk } from '../ground-stream';
import { CHUNK_M } from '../place/lattice';
import { placeOf } from '../stream.test-helper';
import { syntheticPoints } from '../synthetic';
import { disc, edgesOf, type ChunkAt, type Grid } from '../terrain-mesh';
import { placeGrids, type ToGroundWorker } from './grids';

/**
 * Where a streamed chunk comes from (#3606): the page's copy when it has
 * one, else the build worker — the real worker module here, behind a
 * stand-in for the browser's Worker — and the page again if it stops.
 */

type Handler = (e: { data: unknown }) => void;
let run: Handler;

beforeAll(async () => {
	const scope: { postMessage?: (m: unknown) => void; onmessage?: Handler } = {};
	(globalThis as { self?: unknown }).self = scope;
	await import('./build.worker');
	run = (e) => scope.onmessage!(e);
	(globalThis as { self?: unknown }).self = undefined;
});

/** The worker module as a Worker: messages cross asynchronously both ways, as they do in a browser. */
function standIn(opts: { failOnGrids?: boolean } = {}): Worker {
	const listeners = new Map<string, Set<(e: unknown) => void>>();
	const emit = (type: string, e: unknown) =>
		listeners.get(type)?.forEach((f) => f(e));
	let alive = true;
	const w = {
		addEventListener: (type: string, f: (e: unknown) => void) =>
			listeners.set(type, (listeners.get(type) ?? new Set()).add(f)),
		removeEventListener: (type: string, f: (e: unknown) => void) =>
			listeners.get(type)?.delete(f),
		postMessage(data: ToGroundWorker) {
			setTimeout(() => {
				if (!alive) return;
				if (data.type === 'grids' && opts.failOnGrids)
					return emit('error', new Event('error'));
				(globalThis as { self?: unknown }).self = {
					postMessage: (m: unknown) =>
						setTimeout(() => alive && emit('message', { data: m })),
				};
				run({ data });
			});
		},
		terminate() {
			alive = false;
		},
	};
	return w as unknown as Worker;
}

function place() {
	const p = placeOf(syntheticPoints());
	const start: ChunkAt = [
		Math.floor(p.route.x[0] / CHUNK_M),
		Math.floor(p.route.z[0] / CHUNK_M),
	];
	const near = disc(
		(start[0] + 0.5) * CHUNK_M,
		(start[1] + 0.5) * CHUNK_M,
		400,
	);
	// As the place draws them, and one far quad: what a ride's eye asks for.
	const asks: GridAsk[] = near.map((chunk) => ({
		chunk,
		level: p.level(...chunk)!,
		edges: edgesOf(p.level, ...chunk),
	}));
	asks.push({
		chunk: [start[0] + 40, start[1]],
		level: 'far',
		edges: [160, 160, 160, 160],
	});
	return { ...p, asks };
}

const key = (a: GridAsk) => `${a.chunk.join(':')}:${a.level}`;

async function until(done: () => boolean) {
	for (let t = 0; t < 2000 && !done(); t++)
		await new Promise((r) => setTimeout(r, 5));
}

describe('a streamed chunk', () => {
	it('comes at once when the page built it, and from the worker, byte for byte, when it did not', async () => {
		const p = place();
		const [kept, ...rest] = p.asks;
		p.grid(...kept.chunk);
		const got = new Map<string, Grid>();
		const grids = placeGrids(
			p,
			(a, g) => got.set(key(a), g),
			() => standIn(),
		);
		grids.ask(p.asks);
		expect([...got.keys()]).toEqual([key(kept)]);
		await until(() => got.size === p.asks.length);
		grids.dispose();
		const fresh = place();
		for (const a of rest)
			expect(got.get(key(a)), key(a)).toEqual(
				fresh.gridAt(...a.chunk, a.level, a.edges),
			);
		expect(rest.length).toBeGreaterThan(10);
	});

	it('is built on the page when the worker stops, and when none will start', async () => {
		for (const worker of [() => standIn({ failOnGrids: true }), () => null]) {
			const p = place();
			const got = new Set<string>();
			const grids = placeGrids(p, (a) => got.add(key(a)), worker);
			grids.ask(p.asks);
			await until(() => got.size === p.asks.length);
			grids.dispose();
			expect(got.size).toBe(p.asks.length);
		}
	});

	it('stops arriving once the ride lets it go', async () => {
		const p = place();
		let got = 0;
		const grids = placeGrids(
			p,
			() => got++,
			() => standIn(),
		);
		grids.ask(p.asks);
		grids.dispose();
		await new Promise((r) => setTimeout(r, 50));
		expect(got).toBe(0);
	});
});
