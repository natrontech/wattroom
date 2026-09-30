import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { at } from '$lib/road/along';
import { toRoute, type Route } from '$lib/road/route';
import type { TrackPoint } from '$lib/road/parse';
import { road } from './geometry';
import { roadPieces, streamGround, type GroundSink } from './ground-stream';
import { landUse } from './land';
import { CHUNK_M } from './place/lattice';
import { syntheticPoints } from './synthetic';
import {
	createTerrain,
	disc,
	GROUND_M,
	placeLevel,
	type ChunkAt,
	type Grid,
} from './terrain-mesh';
import { makeGround } from './terrain/ground';
import { drawnRows, ROAD_W, SHOULDER } from './terrain/road-profile';
import { DEV_SALT } from './world';
import { BUILD_MS, longLoopPoints } from './world.test-helper';

/**
 * The ride's ground, streamed around the eye (#3606): what it builds is set
 * by where the eye is, never by how long the route is, and a chunk it adds
 * meets the chunks already there with no crack.
 */

/** A route's ground as a world builds it, without the props: what the stream draws from. */
function groundOf(points: TrackPoint[]) {
	const route = toRoute(points);
	const rows = drawnRows(route);
	const ground = makeGround(
		[
			{
				key: 'route',
				x: rows.map((p) => p.x),
				z: rows.map((p) => p.z),
				h: rows.map((p) => p.ele),
			},
		],
		{ salt: DEV_SALT },
	);
	const level = placeLevel(ground.lines);
	return {
		route,
		level,
		terrain: createTerrain(ground, level, landUse(ground.noise)),
	};
}

/** A stream over `g`'s ground, built on the page as asked, counting what it builds. */
function streamOver(g: ReturnType<typeof groundOf>) {
	let built = 0;
	const stream = streamGround((got) => ({
		ask(chunks) {
			built += chunks.length;
			for (const c of chunks) got(c, g.terrain.chunk(...c));
		},
		dispose() {},
	}));
	return { stream, built: () => built };
}

describe('the ground a ride draws around it', () => {
	it(
		'is the same number of chunks around one camera, a 29 km loop or a 124 km one',
		() => {
			const counts = [syntheticPoints(), longLoopPoints()].map((points) => {
				const g = groundOf(points);
				const { stream, built } = streamOver(g);
				stream.update(0, 0);
				expect(stream.held()).toHaveLength(built());
				return built();
			});
			expect(counts[0]).toBe(counts[1]);
			expect(counts[0]).toBe(disc(0, 0, GROUND_M).length);
		},
		BUILD_MS,
	);

	it(
		'adds and drops chunks as the rider rides, and never opens a crack where two meet',
		() => {
			const g = groundOf(syntheticPoints());
			const drawn = new Map<string, { chunk: ChunkAt; grid: Grid }>();
			let added = 0;
			let dropped = 0;
			const sink: GroundSink = {
				add(id, chunk, grid) {
					expect(drawn.has(id)).toBe(false);
					drawn.set(id, { chunk, grid });
					added++;
				},
				drop(id) {
					expect(drawn.delete(id)).toBe(true);
					dropped++;
				},
			};
			const { stream } = streamOver(g);
			stream.attach(sink);
			let worst = 0;
			const faces = { fine: 0, mixed: 0 };
			for (let d = 0; d < g.route.length; d += 1000) {
				const p = at(g.route, d);
				stream.update(p.x, p.z);
				for (const {
					chunk: [ci, cj],
					grid,
				} of drawn.values()) {
					for (const [di, dj] of [
						[1, 0],
						[0, 1],
					] as const) {
						const next = drawn.get(`${ci + di}:${cj + dj}`);
						if (!next) continue;
						const levels = [grid.step, next.grid.step].sort().join();
						if (levels === '10,40') faces.mixed++;
						else if (levels === '10,10') faces.fine++;
						for (let s = 0; s <= CHUNK_M; s += 2.5)
							worst = Math.max(
								worst,
								Math.abs(
									edge(grid, di ? 'east' : 'south', s) -
										edge(next.grid, di ? 'west' : 'north', s),
								),
							);
					}
				}
			}
			expect(dropped).toBeGreaterThan(0);
			expect(added).toBeGreaterThan(drawn.size);
			expect(faces.mixed).toBeGreaterThan(0);
			expect(faces.fine).toBeGreaterThan(0);
			expect(worst).toBeLessThan(1e-3);
		},
		BUILD_MS,
	);
});

/** A grid's height `s` metres along one edge: straight between its vertices, as its triangles draw it. */
function edge(
	g: Grid,
	side: 'west' | 'east' | 'north' | 'south',
	s: number,
): number {
	const n = g.row - 1;
	const vertex = (q: number) =>
		side === 'west'
			? g.h[q * g.row]
			: side === 'east'
				? g.h[q * g.row + n]
				: side === 'north'
					? g.h[q]
					: g.h[n * g.row + q];
	const f = s / g.step;
	const k = Math.min(n - 1, Math.floor(f));
	return vertex(k) + (vertex(k + 1) - vertex(k)) * (f - k);
}

describe('the road a ride draws, piece by piece', () => {
	const route: Route = toRoute(syntheticPoints());
	const whole = road(route, { width: ROAD_W, shoulder: SHOULDER });
	const cols = 5;

	it('covers every row of the ribbon, each piece meeting the next on a shared row', () => {
		const pieces = roadPieces(route);
		expect(pieces[0].rows[0]).toBe(0);
		for (let k = 1; k < pieces.length; k++)
			expect(pieces[k].rows[0]).toBe(pieces[k - 1].rows[1]);
		expect(pieces.at(-1)!.rows[1] + 1).toBe(
			whole.attributes.position.count / cols,
		);
	});

	it('draws each piece exactly as the whole ribbon draws those rows, hairpins and all', () => {
		/** Rows [from, to] of `g`'s attribute `name`. */
		const rows = (
			g: THREE.BufferGeometry,
			name: string,
			from: number,
			to: number,
		) => {
			const { array, itemSize } = g.attributes[name];
			const per = cols * itemSize;
			return Array.from(array.slice(from * per, (to + 1) * per));
		};
		for (const {
			rows: [from, to],
		} of roadPieces(route)) {
			const piece = road(route, {
				width: ROAD_W,
				shoulder: SHOULDER,
				rows: [from, to],
			});
			const n = to - from;
			for (const name of ['position', 'normal', 'uv'])
				expect(rows(piece, name, 0, n), `${name}, rows ${from}–${to}`).toEqual(
					rows(whole, name, from, to),
				);
		}
	});

	it('holds each piece inside the circle it is streamed by', () => {
		for (const p of roadPieces(route))
			for (let k = p.rows[0]; k <= p.rows[1]; k++) {
				const q = at(route, k * 2);
				expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThanOrEqual(p.r);
			}
	});
});
