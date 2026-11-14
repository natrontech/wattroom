import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { turnedRound, unpackRoad } from '#lib/road/road.ts';
import { designedLine } from './designed';
import { DESIGNS, LANDS, landOf } from './designs';
import { MAPS, onLandMap } from './land-map';

describe('the lands’ maps', () => {
	it.each(LANDS.map((l) => [l.name, l] as const))(
		'%s has its picture and its data, and every loop of it shows the whole loop inside the picture',
		(_, land) => {
			const map = MAPS[land.id];
			expect(map?.picture).toBeTruthy();
			expect(map.data.loops).toEqual(land.loops);
			for (const id of land.loops) {
				const line = designedLine(DESIGNS.find((d) => d.id === id)!);
				const { west, east, south, north } = land.bounds;
				for (let i = 0; i < line.x.length; i++) {
					expect(line.x[i]).toBeGreaterThan(west + 200);
					expect(line.x[i]).toBeLessThan(east - 200);
					expect(-line.z[i]).toBeGreaterThan(south + 200);
					expect(-line.z[i]).toBeLessThan(north - 200);
				}
			}
		},
	);

	it('every designed loop that shares its land with others is on Wattalp, and the Valley on its own land', () => {
		for (const d of DESIGNS.filter((k) => k.others))
			expect(landOf(d.id)?.name).toBe('Wattalp');
		expect(landOf('valley')?.name).toBe('Rahmental');
		expect(landOf('intro')).toBeUndefined();
	});

	// The ride's Map view finds a road's place on its map from the road alone: the one a solo ride builds, and the server's copy a session rides (home-roads.golden.test.ts).
	it.each(HOME_ROADS.map((r) => [r.name, r] as const))(
		'%s: a ride on it, either way round, finds its own loop on its land’s map, or none',
		async (_, home) => {
			const land = landOf(home.id);
			const design = land && DESIGNS.find((d) => d.id === home.id);
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
				const ahead = onLandMap(road);
				const back = onLandMap(turnedRound(road));
				if (!design) {
					expect(ahead).toBeUndefined();
					expect(back).toBeUndefined();
					continue;
				}
				expect(ahead?.map).toBe(MAPS[land!.id]);
				expect(back?.map).toBe(MAPS[land!.id]);
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
