import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { turnedRound, unpackRoad } from '#lib/road/road.ts';
import { designedLine } from './designed';
import { DESIGNS, LANDS, landOf } from './designs';
import { landBox, LOOP_MARGIN, loopBox, MAPS, onLandMap } from './land-map';

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

	it.each(LANDS.flatMap((land) => land.loops.map((id) => [id, land] as const)))(
		'%s: the ride’s zoomed Map shows the whole loop inside its land',
		(id, land) => {
			const line = designedLine(DESIGNS.find((d) => d.id === id)!);
			const all = landBox(land.bounds);
			for (const aspect of [16 / 9, 1, 9 / 16]) {
				const box = loopBox(line, land.bounds, aspect);
				expect(box.x).toBeGreaterThanOrEqual(all.x);
				expect(box.z).toBeGreaterThanOrEqual(all.z);
				expect(box.x + box.w).toBeLessThanOrEqual(all.x + all.w + 1e-6);
				expect(box.z + box.h).toBeLessThanOrEqual(all.z + all.h + 1e-6);
				for (let i = 0; i < line.x.length; i++) {
					expect(line.x[i]).toBeGreaterThan(box.x);
					expect(line.x[i]).toBeLessThan(box.x + box.w);
					expect(line.z[i]).toBeGreaterThan(box.z);
					expect(line.z[i]).toBeLessThan(box.z + box.h);
				}
				expect(box.w * box.h).toBeLessThanOrEqual(all.w * all.h);
			}
		},
	);

	describe('loopBox', () => {
		// A land 10 km by 8 km, x from 0 east, z from −8000 (north) south to 0.
		const bounds = { west: 0, east: 10_000, south: 0, north: 8000 };
		const square = (cx: number, cz: number, side: number) => ({
			x: [cx - side / 2, cx + side / 2, cx + side / 2, cx - side / 2],
			z: [cz - side / 2, cz - side / 2, cz + side / 2, cz + side / 2],
		});

		it('is the loop’s box with LOOP_MARGIN of it each side, centred on it', () => {
			const box = loopBox(square(5000, -4000, 1000), bounds, 1);
			const side = 1000 * (1 + 2 * LOOP_MARGIN);
			expect(box).toEqual({
				x: 5000 - side / 2,
				z: -4000 - side / 2,
				w: side,
				h: side,
			});
		});

		it('takes the screen’s shape, widening the short side only', () => {
			const box = loopBox(square(5000, -4000, 1000), bounds, 2);
			expect(box.w / box.h).toBeCloseTo(2);
			expect(box.h).toBeCloseTo(1300);
			expect(box.x + box.w / 2).toBeCloseTo(5000);
			const tall = loopBox(square(5000, -4000, 1000), bounds, 0.5);
			expect(tall.w).toBeCloseTo(1300);
			expect(tall.h).toBeCloseTo(2600);
		});

		it('moves inside the land where the loop sits by its edge', () => {
			const box = loopBox(square(600, -7500, 1000), bounds, 1);
			expect(box.x).toBe(0);
			expect(box.z).toBe(-8000);
			expect(box.w).toBeCloseTo(1300);
		});

		it('is no longer than the land on a side the screen would stretch past it', () => {
			const box = loopBox(square(5000, -4000, 4000), bounds, 4);
			expect(box.w).toBe(10_000);
			expect(box.x).toBe(0);
			expect(box.h).toBeCloseTo(5200);
		});
	});

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
