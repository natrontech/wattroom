// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { toRoute, type Route } from '$lib/road/route';
import { syntheticPoints } from '../synthetic';
import { generate, type World } from '../world';
import { FAMILY } from './batch';
import { formOf, ringAt } from './forest';

let route: Route;
let world: World;

beforeAll(() => {
	route = toRoute(syntheticPoints());
	world = generate(route);
	// The whole corridor settled, as the diorama asks for it.
	void world.everything;
}, 60_000);

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

	it('stands a group near the road in more than one form, each tree its own shade (#4256)', () => {
		const near = world.props.filter(
			(p) => FAMILY[p.kind] === 'trees' && nearest(p.x, p.z).d < 120,
		);
		// Every form of each kind stands, none of them most of its kind.
		for (const kind of ['spruce', 'broadleaf'] as const) {
			const mine = near.filter((p) => p.kind === kind);
			const share = [0, 1, 2].map(
				(f) => mine.filter((p) => p.form === f).length / mine.length,
			);
			expect(Math.min(...share), `${kind}'s rarest form`).toBeGreaterThan(0.1);
			expect(Math.max(...share), `${kind}'s commonest form`).toBeLessThan(0.6);
		}
		// A tree beside another is rarely its twin: the same form and shade.
		const twins = near.filter((p) =>
			near.some(
				(q) =>
					q !== p &&
					Math.hypot(q.x - p.x, q.z - p.z) < 7 &&
					q.form === p.form &&
					Math.abs((q.tone ?? 0) - (p.tone ?? 0)) < 0.1,
			),
		);
		expect(twins.length / near.length).toBeLessThan(0.1);
	});

	it('grows the high forest slender: its spruces mostly the slender form (#4256)', () => {
		const at = (height: number) =>
			[0, 1, 2].map(
				(f) =>
					Array.from({ length: 100 }, (_, i) =>
						formOf(true, height, i / 100),
					).filter((x) => x === f).length,
			);
		const [, slenderHigh] = at(1500);
		const [, slenderLow] = at(600);
		expect(slenderHigh).toBeGreaterThan(50);
		expect(slenderLow).toBeLessThan(slenderHigh / 2);
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
