import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { GOLDEN_SALT, goldenKeying } from '../place/golden.test-helper';
import { chunkOf, type Cell } from '../place/lattice';
import { onStroke, type Keying } from '../place/region';
import { STROKE_STEP_M, type Stroke } from '../place/stroke';
import { createBuilder } from './builder';
import { buildChunk, CHUNK_WORDS } from './chunk';
import {
	CAP_BYTES,
	TTL_MS,
	openChunkCache,
	type ChunkCache,
} from './chunk-cache';
import { corridor } from './corridor';
import { indexStroke, nearest } from './stroke-index';

const hash = (w: Uint32Array) => {
	let h = 0x811c9dc5;
	for (const x of w) h = Math.imul(h ^ x, 0x01000193);
	return (h >>> 0).toString(16).padStart(8, '0');
};
const OWNER = [11, 22, 33, 44] as const;

/** A map stroke in one key frame: 4 km, a gentle S, a vertex every 2 m. */
function mapStroke(): Stroke {
	const n = 2001;
	const points = new Float64Array(2 * n);
	for (let q = 0; q < n; q++) {
		const s = q * STROKE_STEP_M;
		points[2 * q] = s;
		points[2 * q + 1] = 300 * Math.sin(s / 700);
	}
	return {
		key: 'map',
		reversed: false,
		startM: 0,
		length: (n - 1) * STROKE_STEP_M,
		points,
	};
}
/** The part of it a shorter route rides, from `fromM`: the same vertices, the same frame. */
function span(stroke: Stroke, fromM: number, toM: number): Stroke {
	const a = fromM / STROKE_STEP_M;
	const b = toM / STROKE_STEP_M;
	return {
		key: stroke.key,
		reversed: false,
		startM: fromM,
		length: toM - fromM,
		points: stroke.points.slice(2 * a, 2 * b + 2),
	};
}
/** A route over a stroke, its salt the world's (ADR-0081), its first 400 m hidden. */
function ride(stroke: Stroke): Keying {
	return {
		stroke,
		salt: GOLDEN_SALT,
		regions: [onStroke(stroke, { fromM: 0, toM: 400, salt: OWNER })],
	};
}
const build = (chunk: Cell, keying: Keying) =>
	buildChunk(chunk, keying, indexStroke(keying.stroke));
const at = (stroke: Stroke, m: number): Cell => {
	const q = Math.round((m - stroke.startM) / STROKE_STEP_M);
	return chunkOf(stroke.points[2 * q], stroke.points[2 * q + 1]);
};

describe('a world chunk (#3074)', () => {
	it('is the same bytes every time for the same place and snapshot', () => {
		const k = goldenKeying();
		const chunk = at(k.stroke, 3000);
		const words = build(chunk, k);
		expect(words).toHaveLength(CHUNK_WORDS);
		expect(build(chunk, k)).toEqual(words);
		// Pinned: a change here changes every world already cached and shared.
		expect(hash(words)).toBe('114024aa');
	});

	it('is byte-identical for two routes through one place, and private where a route hides its start', () => {
		const map = mapStroke();
		const long = ride(map);
		const short = ride(span(map, 1600, 3600));
		// Far from either route's hidden start: the place alone decides.
		for (const m of [2400, 3000, 3400])
			expect(build(at(map, m), short), `${m} m`).toEqual(
				build(at(map, m), long),
			);
		// At the short route's start the owner's own salt keys it: not the world's.
		const start = at(map, 1700);
		expect(build(start, short)).not.toEqual(build(start, long));
	});
});

describe('the corridor', () => {
	it('covers the road with the chunks ahead of the rider first', () => {
		const map = mapStroke();
		const cells = corridor(map, 320, 2000);
		const place = (c: Cell) =>
			cells.findIndex((x) => x.i === c.i && x.j === c.j);
		// Every stretch of the road has its chunk, and each chunk comes once.
		for (let m = 0; m <= map.length; m += 100)
			expect(place(at(map, m)), `${m} m`).toBeGreaterThanOrEqual(0);
		expect(new Set(cells.map((c) => `${c.i}:${c.j}`)).size).toBe(cells.length);
		// The road ahead comes in the order it is ridden, and all of it before the road behind.
		const ahead = [2000, 2400, 2800, 3200, 3600, 4000].map((m) =>
			place(at(map, m)),
		);
		expect(ahead).toEqual([...ahead].sort((a, b) => a - b));
		const behind = [0, 800, 1600].map((m) => place(at(map, m)));
		expect(Math.min(...behind)).toBeGreaterThan(Math.max(...ahead));
		expect(place(at(map, 2000))).toBe(0);
	});
});

describe('where a spot is along the road', () => {
	it('finds what a search of every segment finds', () => {
		const map = mapStroke();
		const index = indexStroke(map);
		let seed = 3;
		const rnd = () =>
			(seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
		for (let n = 0; n < 200; n++) {
			const x = rnd() * 4000;
			const z = 300 * Math.sin(x / 700) + (rnd() - 0.5) * 200;
			let best = Infinity;
			for (let q = 0; q < map.points.length / 2; q++)
				best = Math.min(
					best,
					Math.hypot(map.points[2 * q] - x, map.points[2 * q + 1] - z),
				);
			expect(nearest(index, x, z)!.dist).toBeLessThanOrEqual(best + 1e-9);
		}
	});
});

describe('the chunk cache', () => {
	const words = (n: number, fill: number) => new Uint32Array(n).fill(fill);

	it('gives back what it kept, until it is a week old', async () => {
		let t = 1_000_000;
		const cache = await openChunkCache(new IDBFactory(), () => t);
		await cache.put('s/1:2', words(8, 7));
		expect(await cache.get('s/1:2')).toEqual(words(8, 7));
		t += TTL_MS + 1;
		expect(await cache.get('s/1:2')).toBeNull();
		// And an expired chunk is gone from storage, not only from the answer.
		t -= TTL_MS + 1;
		expect(await cache.get('s/1:2')).toBeNull();
	});

	it('drops the oldest first to stay under 50 MB', async () => {
		let t = 0;
		const idb = new IDBFactory();
		const cache = await openChunkCache(idb, () => ++t);
		const big = (CAP_BYTES / 4 + 1024) / 4; // a quarter of the cap, and a little more
		for (let n = 0; n < 4; n++) await cache.put(`s/${n}`, words(big, n));
		expect(await cache.get('s/0')).toBeNull();
		for (const n of [1, 2, 3]) expect(await cache.get(`s/${n}`)).not.toBeNull();
		// A cache opened afresh on the same storage knows what it holds.
		const again = await openChunkCache(idb, () => ++t);
		await again.put('s/4', words(big, 4));
		expect(await again.get('s/1')).toBeNull();
		expect(await again.get('s/4')).not.toBeNull();
	});

	it('still rides when storage is denied: nothing kept, everything built', async () => {
		const denied = {
			open: () => {
				throw new DOMException('denied', 'SecurityError');
			},
		} as unknown as IDBFactory;
		const cache = await openChunkCache(denied);
		await cache.put('s/1:2', words(4, 1));
		expect(await cache.get('s/1:2')).toBeNull();
		const k = goldenKeying();
		const chunks = corridor(k.stroke, 160, 0).slice(0, 5);
		const builder = await createBuilder({ keying: k, snapshot: 's', cache });
		const got: Cell[] = [];
		await builder.build(chunks, (c) => got.push(c));
		expect(got).toEqual(chunks);
	});

	it('builds a chunk once, and serves it from the cache after', async () => {
		const k = goldenKeying();
		const cache = await openChunkCache(new IDBFactory());
		const hits: string[] = [];
		const counting: ChunkCache = {
			async get(id) {
				const w = await cache.get(id);
				if (w) hits.push(id);
				return w;
			},
			put: (id, w) => cache.put(id, w),
		};
		const chunks = corridor(k.stroke, 160, 0).slice(0, 4);
		const builder = await createBuilder({
			keying: k,
			snapshot: 'snap',
			cache: counting,
		});
		const first: Uint32Array[] = [];
		await builder.build(chunks, (_c, w) => first.push(w));
		await new Promise((r) => setTimeout(r, 50)); // puts are not awaited by the caller
		expect(hits).toEqual([]);
		const second: Uint32Array[] = [];
		await builder.build(chunks, (_c, w) => second.push(w));
		expect(hits).toHaveLength(4);
		expect(second).toEqual(first);
	});
});
