import { beforeAll, describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { at } from '#lib/road/along.ts';
import type { Road } from '#lib/road/road.ts';
import { toRoute, type Route } from '#lib/road/route.ts';
import { Biome } from './biome';
import { designedFor, designedLine, sceneOf } from './designed';
import { DESIGNS } from './designs';
import { routeOfRoad } from './road-route';
import { syntheticPoints } from './synthetic';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * WattRoom's designed roads (designed.ts): a road and the land round it
 * drawn on one made-up map. What must hold: a rider on a crewmate's road,
 * who holds only its heights and turns, draws the same land in the same
 * place; the road never runs under water or through a mountain; and water
 * lies where the story says it does.
 */

const roadOf = async (id: string): Promise<Road> =>
	(await homeRoute(HOME_ROADS.find((r) => r.id === id)!)).road;

describe.each(DESIGNS.map((d) => [d.id, d] as const))(
	'the designed road %s',
	(id, design) => {
		let road: Road;
		let route: Route;
		let world: World;
		beforeAll(async () => {
			road = await roadOf(id);
			route = routeOfRoad(road);
			world = generate(route);
		}, BUILD_MS);

		it('is one of WattRoom’s roads, known by its length to the centimetre', () => {
			expect(toRoute(syntheticPoints(design.shape)).road.length).toBe(
				design.lengthM,
			);
			expect(designedFor(road)).toBe(design);
			expect(route.scene).toBe(id);
		});

		it('is drawn on its designed line from its heights and turns alone', () => {
			// What a crewmate holds: the packed road, nothing of the design.
			const line = designedLine(design);
			let worst = 0;
			for (let d = 0; d <= road.length; d += 50) {
				const p = at(route, d);
				const q = at(line, d);
				worst = Math.max(worst, Math.hypot(p.x - q.x, p.z - q.z));
			}
			// The walk of its turns alone drifts tens of metres (36 m rms on the Pass loop).
			expect(worst).toBeLessThan(2);
		});

		it('is not a rider’s own road that happens to be as long', () => {
			const theirs: Road = {
				...road,
				heights: road.heights.map((h) => h + 3),
			};
			expect(designedFor(theirs)).toBeUndefined();
			expect(routeOfRoad(theirs).scene).toBeUndefined();
		});

		it('keeps the road out of the water and on its own shelf', () => {
			const scene = sceneOf(id)!;
			const onBridge = (d: number) =>
				world.bridges.some(([a, b]) => d >= a && d <= b);
			for (let d = 0; d <= route.length; d += 20) {
				const p = at(route, d);
				const wet = scene.waterAt(p.x, p.z);
				// Over water only on a bridge, and then well clear of it.
				if (wet !== null) {
					expect(onBridge(d), `${d} m is over water`).toBe(true);
					expect(p.ele - wet, `${d} m over the water`).toBeGreaterThan(4);
				}
				// Off a bridge the ground is the road's own shelf: no mountain over it, no hole under it.
				if (!onBridge(d))
					expect(
						Math.abs(world.heightAt(p.x, p.z) - p.ele),
						`${d} m`,
					).toBeLessThan(1.5);
			}
		});

		it('holds its water: the bed lies under the sheet everywhere', () => {
			for (const water of world.waters) {
				// A stream's water lies at the level of each stretch of it.
				const over = (x: number, z: number) =>
					water.run ? world.waterAt(x, z) : standing.waterAt(x, z);
				const standing = sceneOf(id)!;
				const xs = water.outline.map((p) => p[0]);
				const zs = water.outline.map((p) => p[1]);
				let wet = 0;
				let dry = 0;
				for (let k = 0; k < 4000; k++) {
					// A fixed scatter over the water's box.
					const x =
						Math.min(...xs) +
						((k * 0.6180339887) % 1) * (Math.max(...xs) - Math.min(...xs));
					const z =
						Math.min(...zs) +
						((k * 0.7548776662) % 1) * (Math.max(...zs) - Math.min(...zs));
					const level = over(x, z);
					if (level === null) continue;
					// Within the corridor the world draws.
					if (
						x < world.bounds[0] ||
						x > world.bounds[2] ||
						z < world.bounds[1] ||
						z > world.bounds[3]
					)
						continue;
					wet++;
					// The drawn ground is read between grid points 10 m apart and more: at the water's edge it stands a metre over.
					if (world.heightAt(x, z) > level + 2) dry++;
				}
				if (!water.run) expect(wet).toBeGreaterThan(50);
				// A bridge's piers aside, nothing stands out of it; a stream is a vertex or two wide, and a road's bank may stand in it.
				expect(dry / Math.max(1, wet)).toBeLessThan(water.run ? 0.25 : 0.01);
			}
		});

		it('is drawn as it was drawn: straights straight, no fix out of line', () => {
			// No sample stands off the line through its two neighbours one way and the next the other way: a GPS's noise did, by 40 cm; a bend bows them all one way.
			const line = designedLine(design);
			const bow = (i: number) => {
				const sx = line.x[i + 1] - line.x[i - 1];
				const sz = line.z[i + 1] - line.z[i - 1];
				return (
					((line.x[i] - line.x[i - 1]) * sz -
						(line.z[i] - line.z[i - 1]) * sx) /
					Math.hypot(sx, sz)
				);
			};
			let wobbles = 0;
			for (let i = 1; i + 2 < line.x.length; i++)
				if (
					bow(i) * bow(i + 1) < 0 &&
					Math.min(Math.abs(bow(i)), Math.abs(bow(i + 1))) > 0.05
				)
					wobbles++;
			expect(wobbles).toBe(0);
		});

		it('runs its streams downhill, into water or off the map', () => {
			const streams = world.waters.filter((w) => w.run);
			expect(streams.length).toBeGreaterThan(0);
			for (const s of streams) {
				const { levels } = s.run!;
				for (let i = 1; i < levels.length; i++)
					expect(levels[i]).toBeLessThanOrEqual(levels[i - 1]);
				expect(levels[0] - levels[levels.length - 1]).toBeGreaterThan(2);
			}
		});

		it('stands nothing in the water', () => {
			const stood = [...world.props, ...world.pieces];
			expect(stood.length).toBeGreaterThan(100);
			const wet = stood.filter((p) => world.waterAt(p.x, p.z) !== null);
			expect(wet.map((p) => p.kind)).toEqual([]);
		});
	},
);

describe('Tour de l’Aaren', () => {
	it(
		'crosses its river four times, each on a bridge high over it',
		async () => {
			const route = routeOfRoad(await roadOf('aare'));
			const world = generate(route);
			// A stream's own bridge aside, a few metres long.
			const over = world.bridges.filter(([from, to]) => to - from > 100);
			expect(over).toHaveLength(4);
			for (const [from, to] of over) {
				// Straight across: a bridge has no bend in it.
				expect(
					Math.abs(at(route, to).heading - at(route, from).heading),
				).toBeLessThan(0.02);
				expect(to - from).toBeGreaterThan(120);
				expect(to - from).toBeLessThan(400);
				const mid = at(route, (from + to) / 2);
				expect(world.biomeAt(mid.x, mid.z)).toBe(Biome.Water);
				expect(mid.ele - world.heightAt(mid.x, mid.z)).toBeGreaterThan(30);
				// Its ends stand on land, at the road's height.
				for (const d of [from - 6, to + 6]) {
					const p = at(route, d);
					expect(Math.abs(world.heightAt(p.x, p.z) - p.ele)).toBeLessThan(1.5);
				}
			}
		},
		BUILD_MS,
	);
});

describe('Urnsee-Rundfahrt', () => {
	it('runs along its lake: water within 80 m for most of the east shore', async () => {
		const route = routeOfRoad(await roadOf('urnsee'));
		const scene = sceneOf('urnsee')!;
		let near = 0;
		let all = 0;
		// The east shore: its first 9 km.
		for (let d = 500; d < 9000; d += 100) {
			const p = at(route, d);
			all++;
			for (let a = 0; a < 16; a++) {
				const x = p.x + 80 * Math.cos((a * Math.PI) / 8);
				const z = p.z + 80 * Math.sin((a * Math.PI) / 8);
				if (scene.waterAt(x, z) !== null) {
					near++;
					break;
				}
			}
		}
		expect(near / all).toBeGreaterThan(0.8);
	});

	it(
		'bridges one inlet, and looks down on the lake from its terrace',
		async () => {
			const route = routeOfRoad(await roadOf('urnsee'));
			const world = generate(route);
			expect(world.bridges).toHaveLength(1);
			const top = route.ele.indexOf(Math.max(...route.ele));
			expect(route.ele[top] - world.waters[0].level).toBeGreaterThan(100);
		},
		BUILD_MS,
	);
});

describe('the land a scene lays out', () => {
	const beside = (route: Route, world: World, biome: Biome) => {
		let n = 0;
		for (let d = 0; d < route.length; d += 100) {
			const p = at(route, d);
			for (const side of [-40, 40])
				if (
					world.biomeAt(
						p.x + Math.cos(p.heading) * side,
						p.z - Math.sin(p.heading) * side,
					) === biome
				)
					n++;
		}
		return n;
	};
	it(
		'Col de Berne: a dry valley, a moor, and a white forest under the snow',
		async () => {
			const route = routeOfRoad(await roadOf('berne'));
			const world = generate(route);
			expect(beside(route, world, Biome.Dry)).toBeGreaterThan(20);
			expect(beside(route, world, Biome.Moor)).toBeGreaterThan(10);
			expect(beside(route, world, Biome.Snow)).toBeGreaterThan(40);
			const white = world.props.filter((p) => p.snow);
			expect(white.length).toBeGreaterThan(50);
			// Each stands up in the snow, and the valley's trees are green.
			for (const p of white) expect(p.base).toBeGreaterThan(2000);
			expect(
				world.props.filter((p) => p.kind === 'spruce' && !p.snow).length,
			).toBeGreaterThan(white.length);
			// A stream falls down the face beside the hairpins: white water for a good part of it.
			const fall = world.waters.find((w) => w.run && w.run.levels[0] > 2300)!;
			expect(fall.run!.foam.filter((f) => f > 0.5).length).toBeGreaterThan(30);
		},
		BUILD_MS,
	);
	it(
		'the other two: a moor beside each road, and streams into its water',
		async () => {
			for (const id of ['aare', 'urnsee']) {
				const route = routeOfRoad(await roadOf(id));
				const world = generate(route);
				expect(beside(route, world, Biome.Moor), id).toBeGreaterThan(8);
				const standing = world.waters.find((w) => !w.run)!.level;
				const into = world.waters.filter(
					(w) => w.run && w.run.levels[w.run.levels.length - 1] === standing,
				);
				expect(into.length, id).toBeGreaterThanOrEqual(3);
			}
		},
		BUILD_MS,
	);
});

describe('Col de Berne', () => {
	it('climbs 21 hairpins up a hillside, not a cliff', async () => {
		const route = routeOfRoad(await roadOf('berne'));
		// Turns of more than 120° within 80 m, on the way up to the col.
		const top = route.ele.indexOf(Math.max(...route.ele));
		let hairpins = 0;
		const span = Math.round(80 / route.step);
		const heading = (i: number) =>
			Math.atan2(route.x[i + 1] - route.x[i], route.z[i + 1] - route.z[i]);
		for (let i = 0; i + span < top; i++) {
			let turn = heading(i + span) - heading(i);
			while (turn > Math.PI) turn -= 2 * Math.PI;
			while (turn < -Math.PI) turn += 2 * Math.PI;
			if (Math.abs(turn) > (120 * Math.PI) / 180) {
				hairpins++;
				i += span * 2;
			}
		}
		expect(hairpins).toBe(21);
		// No two legs steeper apart than a hillside: under 45 %.
		let steepest = 0;
		for (let i = 0; i < top; i += 6)
			for (let j = i + 40; j < top; j += 6) {
				const apart = Math.hypot(
					route.x[j] - route.x[i],
					route.z[j] - route.z[i],
				);
				if (apart > 30 && apart < 150)
					steepest = Math.max(steepest, (route.ele[j] - route.ele[i]) / apart);
			}
		expect(steepest).toBeLessThan(0.45);
		expect(route.ele[top]).toBeGreaterThan(2000);
	});

	it(
		'has snow peaks over the col and no bridge anywhere',
		async () => {
			const route = routeOfRoad(await roadOf('berne'));
			const world = generate(route);
			expect(world.bridges).toEqual([]);
			const top = route.ele.indexOf(Math.max(...route.ele));
			let snow = 0;
			for (let a = 0; a < 64; a++)
				for (const r of [1500, 2200, 2800]) {
					const x = route.x[top] + r * Math.cos((a * Math.PI) / 32);
					const z = route.z[top] + r * Math.sin((a * Math.PI) / 32);
					if (world.heightAt(x, z) > 2350) snow++;
				}
			expect(snow).toBeGreaterThan(5);
		},
		BUILD_MS,
	);
});
