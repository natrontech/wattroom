// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { toRoute, type Route } from '$lib/road/route';
import { syntheticPoints } from '../synthetic';
import { generate, type World } from '../world';
import { BUILD_MS } from '../world.test-helper';
import { FAMILY } from './batch';
import { ringAt } from './forest';

let route: Route;
let world: World;

beforeAll(() => {
	route = toRoute(syntheticPoints());
	world = generate(route);
}, BUILD_MS);

/** The road sample nearest a point, and how far it is. */
function nearest(x: number, z: number): { i: number; d: number } {
	let best = { i: 0, d: Infinity };
	for (let i = 0; i < route.x.length; i++) {
		const d = Math.hypot(route.x[i] - x, route.z[i] - z);
		if (d < best.d) best = { i, d };
	}
	return best;
}

describe('the forest frames the road (#3675)', () => {
	it('stands conifers within 10–30 m of the road along most of it', () => {
		const STRETCH = 100;
		const framed = new Set<number>();
		for (const p of world.props) {
			if (p.kind !== 'spruce') continue;
			const { i, d } = nearest(p.x, p.z);
			if (d >= 10 && d <= 30)
				framed.add(Math.floor((i * route.step) / STRETCH));
		}
		const stretches = Math.floor(route.length / STRETCH);
		expect(framed.size / stretches).toBeGreaterThan(0.6);
	});

	it('grows trees in groups near the road, never as an even scatter of single cones', () => {
		const near = world.props.filter(
			(p) => FAMILY[p.kind] === 'trees' && nearest(p.x, p.z).d < 120,
		);
		const paired = near.filter((p) =>
			near.some((q) => q !== p && Math.hypot(q.x - p.x, q.z - p.z) < 7),
		);
		expect(paired.length / near.length).toBeGreaterThan(0.2);
		const heights = near.map((p) => p.scale);
		expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.6);
	});

	it('stands buildings in clusters, villages and farms alike, almost never a lone box', () => {
		const buildings = world.props.filter((p) => FAMILY[p.kind] === 'buildings');
		const lone = buildings.filter(
			(f) =>
				!buildings.some(
					(b) => b !== f && Math.hypot(b.x - f.x, b.z - f.z) < 40,
				),
		);
		expect(buildings.length).toBeGreaterThan(20);
		expect(lone.length / buildings.length).toBeLessThan(0.05);
	});

	it('offsets a neighbour between near and far, by its larger axis', () => {
		for (const [a, b] of [
			[0, 0],
			[1, 1],
			[0.5, 0.5],
			[0.2, 0.9],
			[0.73, 0.31],
		]) {
			const [dx, dz] = ringAt(a, b, 4, 9);
			const m = Math.max(Math.abs(dx), Math.abs(dz));
			expect(m).toBeGreaterThanOrEqual(4);
			expect(m).toBeLessThanOrEqual(9);
		}
	});
});
