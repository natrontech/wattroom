// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { toRoute, type Route } from '$lib/road/route';
import { WORLD_SALT } from '../place/network.test-helper';
import { unmatched, type Thing } from '../place/shared';
import { admit, crowd } from '../placement/check';
import type { P2 } from '../placement/geom';
import type { Placement, Road, Violation } from '../placement/types';
import { hashSeed } from '../rand';
import { syntheticPoints } from '../synthetic';
import { origin, routeLines } from '../terrain/network.test-helper';
import { drawnRows, ROAD_W } from '../terrain/road-profile';
import { generate, type World } from '../world';
import { BUILD_MS } from '../world.test-helper';
import type { Prop } from './scatter';
import { standNetwork } from './stand.test-helper';
import { TILE_M, tileCentre } from './tiles';
import { CHUNK_M } from '../place/lattice';

/**
 * What stands beside the road (#3076): the same props in the same place
 * whichever route reaches it (#3226), and every one of them through #3219's
 * gates.
 */

const things = (props: Prop[]): Thing[] =>
	props.map((p) => ({
		kind: p.kind,
		frame: 'LV95',
		e: origin[0] + p.x,
		n: origin[1] - p.z,
	}));

const propsOf = (lines: ReturnType<typeof routeLines.A>, salt = WORLD_SALT) =>
	standNetwork(lines, salt).props;

describe('the same place stands the same props (#3226)', () => {
	let A: Thing[];
	let B: Thing[];
	let C: Thing[];
	beforeAll(() => {
		A = things(propsOf(routeLines.A()));
		B = things(propsOf(routeLines.B()));
		C = things(propsOf(routeLines.C()));
	}, 60_000);

	it('stands a real crowd of them', () => {
		expect(A.length).toBeGreaterThan(500);
		expect(new Set(A.map((t) => t.kind)).size).toBeGreaterThanOrEqual(3);
	});

	it('matches every prop within 1 cm, whichever route asks', () => {
		expect(unmatched(A, B)).toBe(0);
		expect(unmatched(A, C)).toBe(0);
	});

	it(
		'would not, keyed by the route',
		() => {
			const byName = things(
				propsOf(routeLines.B(), [hashSeed('Toyjoch climb'), 1, 2, 3]),
			);
			expect(unmatched(A, byName)).toBeGreaterThan(A.length / 2);
		},
		BUILD_MS,
	);
});

/** The road as short overlapping stretches, and those near a footprint: O1 measured against all of it, cheaply. */
function roadsBy(points: readonly P2[]) {
	const pieces: { road: Road; box: [number, number, number, number] }[] = [];
	for (let a = 0; a < points.length - 1; a += 40) {
		const slice = points.slice(
			Math.max(0, a - 6),
			Math.min(points.length, a + 46),
		);
		const xs = slice.map((p) => p[0]);
		const zs = slice.map((p) => p[1]);
		pieces.push({
			road: { points: slice, halfWidth: ROAD_W / 2 },
			box: [
				Math.min(...xs) - 60,
				Math.min(...zs) - 60,
				Math.max(...xs) + 60,
				Math.max(...zs) + 60,
			],
		});
	}
	return (p: Placement) => {
		const [x, z] = p.footprint[0];
		return pieces
			.filter(({ box: [a, b, c, d] }) => x > a && x < c && z > b && z < d)
			.map((q) => q.road);
	};
}

describe('the dev world’s props', () => {
	let route: Route;
	let w: World;
	beforeAll(() => {
		route = toRoute(syntheticPoints());
		w = generate(route);
		// The whole corridor settled, as the diorama asks for it.
		void w.everything;
	}, 60_000);

	it('passes every gate: nothing on the road, nothing floating, sunk past its share or overlapping', () => {
		const near = roadsBy(drawnRows(route).map((p) => [p.x, p.z] as P2));
		const seen = crowd();
		const out: Violation[] = [];
		// Props and set pieces alike: road furniture stands on the ribbon where it is drawn.
		const drawn = (x: number, z: number) =>
			w.roadSurfaceAt(x, z) ?? w.heightAt(x, z);
		for (const p of w.placements) {
			out.push(...admit(p, near(p), drawn, seen));
			seen.add(p);
		}
		expect(w.placements.length).toBeGreaterThan(3000);
		expect(out).toEqual([]);
	});

	it('builds each village around its church, and grazes cows', () => {
		const kinds = w.placements.map((p) => p.kind);
		expect(w.villageNames.length).toBeGreaterThanOrEqual(1);
		expect(kinds.filter((k) => k === 'church').length).toBe(
			w.villageNames.length,
		);
		expect(kinds.filter((k) => k === 'house').length).toBeGreaterThan(10);
		expect(kinds.filter((k) => k === 'cow').length).toBeGreaterThan(0);
	});
});

describe('the props stream with the ground (#3699)', () => {
	let route: Route;
	beforeAll(() => {
		route = toRoute(syntheticPoints());
	});

	it('stands the same things in a tile whichever tile a ride asked for first', () => {
		const ahead = generate(route);
		const behind = generate(route);
		const [x, z] = [route.x[0], route.z[0]];
		const tiles = ahead.tilesWithin(x, z, 900);
		const forward = tiles.map(([ti, tj]) => ahead.tile(ti, tj));
		const back = [...tiles].reverse().map(([ti, tj]) => behind.tile(ti, tj));
		back.reverse();
		expect(forward.reduce((n, t) => n + t.props.length, 0)).toBeGreaterThan(50);
		expect(JSON.stringify(back)).toBe(JSON.stringify(forward));
	});

	it('settles the tiles around the eye from a sliver of the ground', () => {
		const world = generate(route);
		const [x, z] = [route.x[0], route.z[0]];
		const [x0, z0, x1, z1] = world.bounds;
		const built = () => {
			const out = new Set<string>();
			for (let cj = Math.floor(z0 / CHUNK_M); cj < z1 / CHUNK_M; cj++)
				for (let ci = Math.floor(x0 / CHUNK_M); ci < x1 / CHUNK_M; ci++)
					if (world.peek(ci, cj) !== undefined) out.add(`${ci}:${cj}`);
			return out;
		};
		const before = built();
		for (const [ti, tj] of world.tilesWithin(x, z, 600)) world.tile(ti, tj);
		const asked = [...built()].filter((id) => !before.has(id));
		// Its own ground and its neighbours', and the road behind each set piece as far as O9 looks back.
		const corridor = ((x1 - x0) / CHUNK_M) * ((z1 - z0) / CHUNK_M);
		expect(asked.length).toBeGreaterThan(0);
		expect(asked.length / corridor).toBeLessThan(0.1);
		// And a tile across the loop waits until something asks for it.
		const [ti, tj] = world.tilesWithin(-x, -z, TILE_M)[0];
		expect(Math.hypot(...tileCentre(ti, tj)) - Math.hypot(x, z)).toBeLessThan(
			TILE_M,
		);
		expect(world.settled(ti, tj)).toBe(false);
	});
});
