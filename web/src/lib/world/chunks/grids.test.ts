import { beforeAll, describe, expect, it } from 'vitest';
import { toRoute } from '$lib/road/route';
import { landUse } from '../land';
import { CHUNK_M } from '../place/lattice';
import { syntheticPoints } from '../synthetic';
import {
	createTerrain,
	disc,
	placeLevel,
	type ChunkAt,
	type Grid,
} from '../terrain-mesh';
import { makeGround } from '../terrain/ground';
import type { Line } from '../terrain/lines';
import { drawnRows } from '../terrain/road-profile';
import { DEV_SALT } from '../world';
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
	const route = toRoute(syntheticPoints());
	const rows = drawnRows(route);
	const roads: Line[] = [
		{
			key: 'route',
			x: rows.map((p) => p.x),
			z: rows.map((p) => p.z),
			h: rows.map((p) => p.ele),
		},
	];
	const ground = makeGround(roads, { salt: DEV_SALT });
	const terrain = createTerrain(
		ground,
		placeLevel(ground.lines),
		landUse(ground.noise),
	);
	const start: ChunkAt = [
		Math.floor(route.x[0] / CHUNK_M),
		Math.floor(route.z[0] / CHUNK_M),
	];
	return {
		roads,
		salt: DEV_SALT,
		grid: terrain.chunk,
		peek: terrain.peek,
		near: disc((start[0] + 0.5) * CHUNK_M, (start[1] + 0.5) * CHUNK_M, 400),
	};
}

async function until(done: () => boolean) {
	for (let t = 0; t < 2000 && !done(); t++)
		await new Promise((r) => setTimeout(r, 5));
}

describe('a streamed chunk', () => {
	it('comes at once when the page built it, and from the worker, byte for byte, when it did not', async () => {
		const p = place();
		const [kept, ...rest] = p.near;
		p.grid(...kept);
		const got = new Map<string, Grid | null>();
		const grids = placeGrids(
			p,
			(c, g) => got.set(c.join(':'), g),
			() => standIn(),
		);
		grids.ask(p.near);
		expect([...got.keys()]).toEqual([kept.join(':')]);
		await until(() => got.size === p.near.length);
		grids.dispose();
		const fresh = place();
		for (const c of rest)
			expect(got.get(c.join(':')), c.join(':')).toEqual(fresh.grid(...c));
		expect(rest.length).toBeGreaterThan(10);
	});

	it('is built on the page when the worker stops, and when none will start', async () => {
		for (const worker of [() => standIn({ failOnGrids: true }), () => null]) {
			const p = place();
			const got = new Set<string>();
			const grids = placeGrids(p, (c) => got.add(c.join(':')), worker);
			grids.ask(p.near);
			await until(() => got.size === p.near.length);
			grids.dispose();
			expect(got.size).toBe(p.near.length);
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
		grids.ask(p.near);
		grids.dispose();
		await new Promise((r) => setTimeout(r, 50));
		expect(got).toBe(0);
	});
});
