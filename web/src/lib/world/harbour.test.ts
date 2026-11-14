import { beforeAll, describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { sceneOf } from './designed';
import {
	BOATHOUSE,
	harbour,
	harbourPieces,
	JETTY,
	type HarbourPiece,
} from './harbour';
import { at } from '#lib/road/along.ts';
import { routeOfRoad } from './road-route';
import { FORMATION } from './terrain/road-profile';
import { RIDE } from './look.test-helper';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';
import type { Route } from '#lib/road/route.ts';

/**
 * Schifftritt's harbour on the Urnersee loop (harbour.ts): a jetty run out
 * into the lake, its boats on the water beside it, its boathouse on the
 * bank, none of it on the road, and all of it in a rider's sight from the
 * bridge over the inlet.
 */
describe('the harbour at Schifftritt', () => {
	let route: Route;
	let world: World;
	let pieces: HarbourPiece[];
	beforeAll(async () => {
		route = routeOfRoad(
			(await homeRoute(HOME_ROADS.find((r) => r.id === 'urnsee')!)).road,
		);
		world = generate(route);
		const spot = sceneOf(route.scene)!.names.hamlets!.find(
			(h) => h.name === 'Schifftritt',
		)!.harbour!;
		pieces = harbourPieces(spot, world, RIDE.props);
	}, BUILD_MS);

	const of = (what: HarbourPiece['what']) =>
		pieces.filter((p) => p.what === what);
	const out = (p: HarbourPiece, m: number) =>
		[p.x + Math.sin(p.turn) * m, p.z + Math.cos(p.turn) * m] as const;

	it('runs its jetty from the bank out over the water', () => {
		const [jetty] = of('jetty');
		expect(jetty).toBeDefined();
		expect(world.waterAt(...out(jetty, -JETTY.back))).toBeNull();
		for (const m of [4, JETTY.out / 2, JETTY.out])
			expect(world.waterAt(...out(jetty, m)), `${m} m out`).not.toBeNull();
	});

	it('moors three boats on the water and stands its boathouse on the bank', () => {
		const boats = of('boat');
		expect(boats).toHaveLength(3);
		for (const b of boats) expect(world.waterAt(b.x, b.z)).not.toBeNull();
		const [house] = of('boathouse');
		expect(house).toBeDefined();
		expect(world.waterAt(house.x, house.z)).toBeNull();
		expect(house.ele).toBeGreaterThan(
			world.waterAt(...out(of('jetty')[0], 10))!,
		);
	});

	it('stands its boathouse on a level shelf at the water, and runs its jetty out from that shelf', () => {
		const [house] = of('boathouse');
		const [jetty] = of('jetty');
		const level = jetty.ele;
		const [c, s] = [Math.cos(house.turn), Math.sin(house.turn)];
		const under = (a: number, b: number) => {
			const lx = (a * BOATHOUSE.wide) / 2;
			const lz = (b * BOATHOUSE.deep) / 2;
			return world.heightAt(
				house.x + lx * c + lz * s,
				house.z - lx * s + lz * c,
			);
		};
		const all = [-1, 0, 1].flatMap((a) => [-1, 0, 1].map((b) => under(a, b)));
		// From the waterline at its doors (+z) to the shelf at its back: no bank it is half inside.
		expect(Math.max(...all) - Math.min(...all)).toBeLessThan(1.6);
		for (const a of [-1, 0, 1])
			expect(Math.abs(under(a, -1) - house.ele), 'its back').toBeLessThan(0.3);
		expect(house.ele - level).toBeLessThan(1);
		// The land behind the jetty's root no higher than its deck: it starts on the shelf, not in a bank.
		for (let m = -JETTY.back - 8; m <= 0; m += 2)
			expect(world.heightAt(...out(jetty, m)), `${m} m`).toBeLessThan(
				level + JETTY.deck + 0.5,
			);
	});

	it('keeps all of it off the road', () => {
		for (const p of pieces) {
			const reach = p.what === 'boathouse' ? BOATHOUSE.deep : 2;
			expect(world.clearOf(p.x, p.z, FORMATION + reach), p.what).toBe(true);
		}
		expect(harbour(route, pieces)!.attributes.position.count).toBeGreaterThan(
			0,
		);
	});

	it('lies in sight of the road over the inlet’s bridge, no bank between', () => {
		const hidden: string[] = [];
		// Ahead and to the left over the water, until the bank at the bridge's far end comes between in its last 60 m.
		for (let d = 3160; d <= 3280; d += 30) {
			const r = at(route, d);
			// A rider's eye, a chase camera's, over the deck.
			const eye = r.ele + 2.5;
			for (const p of pieces) {
				const top = p.ele + (p.what === 'boathouse' ? 3 : 0.6);
				for (let k = 1; k < 40; k++) {
					const t = k / 40;
					const g = world.groundAt(
						r.x + (p.x - r.x) * t,
						r.z + (p.z - r.z) * t,
					);
					if (g > eye + (top - eye) * t) {
						hidden.push(`${p.what} from ${d} m`);
						break;
					}
				}
			}
		}
		expect(hidden).toEqual([]);
	});
});
