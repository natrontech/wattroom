import { beforeAll, describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { Biome } from './biome';
import { routeOfRoad } from './road-route';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * Col de Berne's high ground (setpieces-stroke.ts): where a hay bale or a
 * fence would stand on alpine pasture, rock or snow, a cairn stands instead,
 * and no fountain's trough stands on snow or a crag.
 */
describe('the pass road’s bare ground', () => {
	let world: World;
	beforeAll(async () => {
		const road = (await homeRoute(HOME_ROADS.find((r) => r.id === 'berne')!))
			.road;
		world = generate(routeOfRoad(road));
	}, BUILD_MS);

	const bare = new Set<number>([
		Biome.Alpine,
		Biome.Rock,
		Biome.Snow,
		Biome.Frost,
	]);

	it(
		'stands its cairns on the high ground, and only there',
		() => {
			const cairns = world.pieces.filter((p) => p.kind === 'cairn');
			expect(cairns.length).toBeGreaterThan(0);
			for (const c of cairns)
				expect(bare.has(world.biomeAt(c.x, c.z)!)).toBe(true);
		},
		BUILD_MS,
	);

	it(
		'stands no fountain on snow or rock',
		() => {
			const frozen = world.pieces.filter(
				(p) =>
					p.kind === 'fountain' &&
					[Biome.Rock, Biome.Snow, Biome.Frost].includes(
						world.biomeAt(p.x, p.z) as typeof Biome.Rock,
					),
			);
			expect(frozen).toEqual([]);
		},
		BUILD_MS,
	);
});
