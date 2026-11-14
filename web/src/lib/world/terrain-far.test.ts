import { beforeAll, describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import type { Route } from '#lib/road/route.ts';
import { terrain } from './geometry';
import { RIDE } from './look.test-helper';
import { CHUNK_M } from './place/lattice';
import { routeOfRoad } from './road-route';
import { meshOf, STEP, type Grid } from './terrain-mesh';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * The far ground, one quad a chunk (terrain-grid.ts BLEND): each vertex's
 * colour and covers are the ground's round it, so the Kettental's fields,
 * 75 m strips each its own crop, read from afar as a blend of them rather
 * than a square of whichever crop a corner landed on.
 */
describe('the far ground over the Kettental’s fields', () => {
	let route: Route;
	let world: World;
	const chunks: { ci: number; cj: number; grid: Grid }[] = [];
	const N = 8;
	beforeAll(async () => {
		route = routeOfRoad(
			(await homeRoute(HOME_ROADS.find((r) => r.id === 'kette')!)).road,
		);
		world = generate(route);
		// The valley floor, its fields either side of the road and the river: a block of far chunks, each drawn as one quad.
		const ci0 = Math.floor(-8000 / CHUNK_M);
		const cj0 = Math.floor(-2000 / CHUNK_M);
		const far = STEP.far;
		for (let j = 0; j < N; j++)
			for (let i = 0; i < N; i++)
				chunks.push({
					ci: ci0 + i,
					cj: cj0 + j,
					grid: world.gridAt(ci0 + i, cj0 + j, 'far', [far, far, far, far]),
				});
	}, BUILD_MS);

	/** Mean colour step between each vertex and its east and south neighbours, over the block. */
	const roughness = (colors: ArrayLike<number>) => {
		// Each chunk is 2 × 2 vertices; neighbours across chunks share a place, so step within each.
		let sum = 0;
		let n = 0;
		for (let c = 0; c < chunks.length; c++) {
			const v = c * 4;
			for (const [a, b] of [
				[0, 1],
				[0, 2],
				[1, 3],
				[2, 3],
			]) {
				for (let k = 0; k < 3; k++)
					sum += Math.abs(colors[(v + a) * 3 + k] - colors[(v + b) * 3 + k]);
				n++;
			}
		}
		return sum / n;
	};

	it('blends each vertex from the ground round it, at the same triangles', () => {
		expect(chunks.every((c) => c.grid.row === 2 && c.grid.blend)).toBe(true);
		const mesh = meshOf(chunks);
		const blended = terrain(route, mesh, RIDE.palette);
		const point = terrain(
			route,
			{ ...mesh, blend: new Uint8Array(mesh.blend.length).fill(255) },
			RIDE.palette,
		);
		expect(blended.index!.count).toBe(point.index!.count);
		expect(blended.index!.count).toBe(N * N * 6);
		expect(roughness(blended.attributes.color.array)).toBeLessThan(
			0.75 * roughness(point.attributes.color.array),
		);
	});

	it('gives a far vertex covers in shares, so they vary within a chunk', () => {
		const g = terrain(route, meshOf(chunks), RIDE.palette);
		const cover = g.attributes.cover.array;
		const shares = new Set<number>();
		for (let i = 0; i < cover.length; i++) shares.add(cover[i]);
		// Not only none or whole: some vertex holds part of a cover.
		expect([...shares].some((s) => s > 0 && s < 255)).toBe(true);
	});
});
