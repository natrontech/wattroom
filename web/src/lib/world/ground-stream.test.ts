import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { at } from '$lib/road/along';
import { toRoute, type Route } from '$lib/road/route';
import type { TrackPoint } from '$lib/road/parse';
import { pageGrids } from './chunks/grids';
import { road } from './geometry';
import { roadPieces, streamGround, type GroundSink } from './ground-stream';
import { CHUNK_M } from './place/lattice';
import { placeOf } from './stream.test-helper';
import { syntheticPoints } from './synthetic';
import { disc, REACH, type ChunkAt, type Grid } from './terrain-mesh';
import { ROAD_W, SHOULDER } from './terrain/road-profile';
import { BUILD_MS, longLoopPoints } from './world.test-helper';

/**
 * The ride's ground, streamed around the eye (#3606): what it builds is set
 * by where the eye is, never by how long the route is, and a chunk it adds
 * or swaps meets the chunks already there with no crack, whatever levels the
 * two are drawn at.
 */

/** A stream over `points`' ground, built on the page as asked, counting what it builds. */
function streamOver(points: TrackPoint[]) {
	const place = placeOf(points);
	const page = pageGrids(place);
	let built = 0;
	const stream = streamGround(
		(got) => ({
			...page(got),
			ask(asks) {
				built += asks.length;
				page(got).ask(asks);
			},
		}),
		place.level,
	);
	return { route: place.route, stream, built: () => built };
}

describe('the ground a ride draws around it', () => {
	it(
		'is the same number of chunks around one camera, a 29 km loop or a 124 km one',
		() => {
			const counts = [syntheticPoints(), longLoopPoints()].map((points) => {
				const { stream, built } = streamOver(points);
				stream.update(0, 0);
				expect(stream.held()).toHaveLength(built());
				return built();
			});
			expect(counts[0]).toBe(counts[1]);
			expect(counts[0]).toBe(disc(0, 0, REACH.far).length);
		},
		BUILD_MS,
	);

	it(
		'adds and drops chunks as the rider rides, and never opens a crack where two meet',
		() => {
			const { route, stream } = streamOver(syntheticPoints());
			const drawn = new Map<string, { chunk: ChunkAt; grid: Grid }>();
			let added = 0;
			let dropped = 0;
			const sink: GroundSink = {
				add(id, chunk, grid) {
					drawn.set(id, { chunk, grid });
					added++;
				},
				drop(id) {
					expect(drawn.delete(id)).toBe(true);
					dropped++;
				},
			};
			stream.attach(sink);
			let worst = 0;
			const faces = new Map<string, number>();
			// 100 m steps for the first 3 km, as a ride moves; then 1 km jumps, as a stall or a seek does.
			for (let d = 0; d < route.length; d += d < 3000 ? 100 : 1000) {
				const p = at(route, d);
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
						const fine = Math.min(grid.step, next.grid.step);
						const steps = `${fine},${Math.max(grid.step, next.grid.step)}`;
						faces.set(steps, (faces.get(steps) ?? 0) + 1);
						// Two straight-edged polylines part only at a vertex of the finer one; two quads share their corners.
						if (fine === CHUNK_M) continue;
						for (let s = 0; s <= CHUNK_M; s += fine)
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
			// Fine meets coarse at a road, coarse meets far at the near reach, and each meets its own.
			for (const k of ['10,10', '10,40', '40,40', '40,160', '160,160'])
				expect(faces.get(k), k).toBeGreaterThan(0);
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
