import { beforeAll, describe, expect, it } from 'vitest';
import type { Road } from '$lib/road/road';
import type { Route } from '$lib/road/route';
import { Biome } from './biome';
import { parapet } from './geometry';
import { routeOfRoad } from './road-route';
import { rowCount } from './terrain/road-profile';
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
	it('wall each leg above the first on its valley side (#3838)', () => {
		const wall = parapet(route, world.heightAt, [0, rowCount(route) - 1]);
		const along = (wall?.attributes.uv.array ?? []).filter((_, i) => i % 2);
		const walled = new Set(along);
		const LEG = 700; // 30 rows of 20 m, then the turn
		const share = (leg: number) =>
			[...walled].filter((d) => d >= leg * LEG && d < (leg + 1) * LEG).length /
			(Math.min(LEG, route.length - leg * LEG) / 2);
		expect(share(0)).toBeLessThan(0.1); // it rises from the valley's own ground
		for (const leg of [1, 2, 3]) expect(share(leg)).toBeGreaterThan(0.4);
	});
});
