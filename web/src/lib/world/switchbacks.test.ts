import { beforeAll, describe, expect, it } from 'vitest';
import type { Road } from '$lib/road/road';
import type { Route } from '$lib/road/route';
import { Biome } from './biome';
import { routeOfRoad } from './road-route';
import { drawnRows, FORMATION, rowCount } from './terrain/road-profile';
import { generate, type World } from './world';
import { BUILD_MS, worstRiseThroughRoad } from './world.test-helper';

/**
 * Stacked switchbacks (#3709): legs closer than their earthworks allow,
 * the design capture's hairpin fixture in a road's own terms — 600 m legs
 * climbing 6.5 %, turned 180° over 100 m, so each leg runs about 60 m from
 * the last and up to 78 m above it at the far end. The ground between
 * them is a wall; it never rises through either road.
 */

function stacked(legs: number): Road {
	const heights = [100];
	const turns: number[] = [];
	for (let leg = 0; leg < legs; leg++) {
		for (let s = 0; s < 30; s++) turns.push(0);
		if (leg < legs - 1)
			for (let s = 0; s < 5; s++) turns.push(leg % 2 ? -36 : 36);
	}
	for (let i = 0; i < turns.length; i++) heights.push(heights[i] + 0.065 * 20);
	return { length: turns.length * 20, heights, turns };
}

let route: Route;
let world: World;
beforeAll(() => {
	route = routeOfRoad(stacked(4));
	world = generate(route);
}, BUILD_MS);

describe('stacked switchbacks', () => {
	it('never lift the ground through a road, even where two legs disagree', () => {
		expect(worstRiseThroughRoad(route, world)).toBeLessThan(0.2);
	});

	it('grow the wall between legs over, not paint it bare rock (#3838)', () => {
		const { pos, biome } = world.mesh;
		const toRoad = (x: number, z: number) => {
			let d = Infinity;
			for (let i = 0; i < route.x.length; i++)
				d = Math.min(d, Math.hypot(route.x[i] - x, route.z[i] - z));
			return d;
		};
		let wall = 0;
		let rock = 0;
		for (let v = 0; v < pos.length / 3; v++) {
			const [x, z] = [pos[v * 3], pos[v * 3 + 2]];
			const d = toRoad(x, z);
			if (d < 10 || d > 58) continue;
			const gx = (world.heightAt(x + 5, z) - world.heightAt(x - 5, z)) / 10;
			const gz = (world.heightAt(x, z + 5) - world.heightAt(x, z - 5)) / 10;
			if (Math.hypot(gx, gz) <= 0.85) continue;
			wall++;
			if (biome[v] === Biome.Rock) rock++;
		}
		expect(wall).toBeGreaterThan(100);
		expect(rock / wall).toBeLessThan(0.4);
	});
});

describe('stacked switchbacks, seen from below', () => {
	it('post each leg every 25 m on the side its ground falls away (#3838)', () => {
		const rows = drawnRows(route, 2, 0, rowCount(route) - 1);
		const LEG = 700; // 30 rows of 20 m, then the turn
		/** Posts and fall-away rows per leg and side, keyed `leg:side`. */
		const posts = new Map<string, number>();
		const falls = new Map<string, number>();
		const keyOf = (i: number, side: number) =>
			`${Math.floor((i * 2) / LEG)}:${side}`;
		const dropsAway = (p: (typeof rows)[number], side: number) =>
			p.ele -
				world.heightAt(
					p.x + Math.cos(p.heading) * side * (FORMATION + 8),
					p.z - Math.sin(p.heading) * side * (FORMATION + 8),
				) >
			4;
		rows.forEach((p, i) => {
			for (const side of [-1, 1])
				if (dropsAway(p, side)) {
					const k = keyOf(i, side);
					falls.set(k, (falls.get(k) ?? 0) + 2);
				}
		});
		for (const d of world.pieces) {
			if (d.kind !== 'delineator') continue;
			let i = 0;
			let best = Infinity;
			rows.forEach((p, j) => {
				const dd = Math.hypot(p.x - d.x, p.z - d.z);
				if (dd < best) [best, i] = [dd, j];
			});
			const p = rows[i];
			const side = Math.sign(
				(d.x - p.x) * Math.cos(p.heading) - (d.z - p.z) * Math.sin(p.heading),
			);
			if (!dropsAway(p, side)) continue;
			const k = keyOf(i, side);
			posts.set(k, (posts.get(k) ?? 0) + 1);
		}
		// The first leg rises from the valley's own ground; every leg above it drops away somewhere.
		expect(falls.has('0:1') || falls.has('0:-1')).toBe(false);
		for (const leg of [1, 2, 3])
			expect(falls.has(`${leg}:1`) || falls.has(`${leg}:-1`)).toBe(true);
		for (const [k, m] of falls)
			if (m >= 100) expect((posts.get(k) ?? 0) / m, k).toBeGreaterThan(1 / 30);
	});
});
