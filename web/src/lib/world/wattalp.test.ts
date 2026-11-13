import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { turnedRound, unpackRoad } from '#lib/road/road.ts';
import { designedLine } from './designed';
import { DESIGNS, MAP_BOUNDS } from './designs';
import { onWattalp, WATTALP } from './wattalp';

/** The loops of the one map: every design that shares its land with others. */
const LOOPS = DESIGNS.filter((d) => d.others);

describe('the Wattalp map', () => {
	it.each(LOOPS.map((d) => [d.id, d] as const))(
		'shows %s, the whole loop inside its picture',
		(_, d) => {
			expect(WATTALP.loops).toContain(d.id);
			const line = designedLine(d);
			const { west, east, south, north } = MAP_BOUNDS;
			for (let i = 0; i < line.x.length; i++) {
				expect(line.x[i]).toBeGreaterThan(west + 200);
				expect(line.x[i]).toBeLessThan(east - 200);
				expect(-line.z[i]).toBeGreaterThan(south + 200);
				expect(-line.z[i]).toBeLessThan(north - 200);
			}
		},
	);

	// The ride's Map view finds a road's place on the map from the road alone: the one a solo ride builds, and the server's copy a session rides (home-roads.golden.test.ts).
	it.each(HOME_ROADS.map((r) => [r.name, r] as const))(
		'%s: a ride on it, either way round, finds its own loop on the map, or none',
		async (_, home) => {
			const design = LOOPS.find((d) => d.id === home.id);
			const frozen = unpackRoad(
				new Uint8Array(
					readFileSync(
						new URL(
							`../../../../server/internal/routes/library/${home.routeId}.road`,
							import.meta.url,
						),
					),
				),
			);
			for (const road of [(await homeRoute(home)).road, frozen]) {
				const ahead = onWattalp(road);
				const back = onWattalp(turnedRound(road));
				if (!design) {
					expect(ahead).toBeUndefined();
					expect(back).toBeUndefined();
					continue;
				}
				expect(ahead?.reverse).toBe(false);
				expect(back?.reverse).toBe(true);
				expect(ahead?.line).toBe(designedLine(design));
				expect(back?.line).toBe(designedLine(design));
				expect(ahead!.line.length).toBeCloseTo(road.length, 1);
			}
		},
		120_000,
	);
});
