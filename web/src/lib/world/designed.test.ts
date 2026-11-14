import { beforeAll, describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { at } from '#lib/road/along.ts';
import type { Road } from '#lib/road/road.ts';
import { toRoute, type Route } from '#lib/road/route.ts';
import { Biome } from './biome';
import {
	ARM_M,
	armWiden,
	designedFor,
	designedLine,
	ringSignAt,
	roundaboutsOf,
	sceneOf,
} from './designed';
import { DESIGNS } from './designs';
import { routeOfRoad } from './road-route';
import { syntheticPoints } from './synthetic';
import { generate, type World } from './world';
import { JOINED, JOINS, meetingAt } from './crossings';
import { GRAVEL_W, ribbonOf, ROAD_LIFT, surfaceOf } from './geometry';
import { liftOf } from './road-surface';
import {
	giveWays,
	SQUARE_COS,
	STOP_LANE,
	STOP_LINE,
	stopped,
	stops,
} from './scenery';
import { sharedAt } from './shared-road';
import { FORMATION, ROAD_W } from './terrain/road-profile';
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
			// A tunnel's hill stands over it, and the ground drawn into its portal's cutting leans on the hill.
			const inTunnel = (d: number) =>
				world.tunnels.some(([a, b]) => d >= a - 12 && d <= b + 12);
			for (let d = 0; d <= route.length; d += 20) {
				const p = at(route, d);
				const wet = scene.waterAt(p.x, p.z);
				// Over water only on a bridge, and then well clear of it.
				if (wet !== null) {
					expect(onBridge(d), `${d} m is over water`).toBe(true);
					expect(p.ele - wet, `${d} m over the water`).toBeGreaterThan(4);
				}
				// Off a bridge the ground is the road's own shelf: no mountain over it, no hole under it, but in a tunnel.
				if (!onBridge(d) && !inTunnel(d))
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
			// Left, right, left within three samples: a bend into a roundabout and round it turns once each way, a zigzag keeps turning back.
			let wobbles = 0;
			const off = (i: number) =>
				Math.abs(bow(i)) > 0.05 ? Math.sign(bow(i)) : 0;
			for (let i = 1; i + 3 < line.x.length; i++)
				if (off(i) * off(i + 1) < 0 && off(i + 1) * off(i + 2) < 0) wobbles++;
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

		it(
			'stands nothing in the water',
			() => {
				const stood = [...world.props, ...world.pieces];
				expect(stood.length).toBeGreaterThan(100);
				const wet = stood.filter((p) => world.waterAt(p.x, p.z) !== null);
				expect(wet.map((p) => p.kind)).toEqual([]);
				// The whole map's things, every side road's too.
			},
			// Every tile of the whole map's roads.
			3 * BUILD_MS,
		);
	},
);

describe('Tour de l’Aaren', () => {
	it(
		'crosses its river twice, each time straight over on a bridge high over it',
		async () => {
			const route = routeOfRoad(await roadOf('aare'));
			const world = generate(route);
			// A stream's own bridge aside, a few metres long.
			const over = world.bridges.filter(([from, to]) => to - from > 100);
			expect(over).toHaveLength(2);
			for (const [from, to] of over) {
				expect(
					Math.abs(at(route, to).heading - at(route, from).heading),
				).toBeLessThan(0.02);
				expect(to - from).toBeLessThan(650);
				const mid = at(route, (from + to) / 2);
				expect(world.biomeAt(mid.x, mid.z)).toBe(Biome.Water);
				expect(mid.ele - world.heightAt(mid.x, mid.z)).toBeGreaterThan(30);
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
	it(
		'runs along its lake round the bays, through the Nase, under a gallery, over the inlet and the outlet, and looks down on it from its terrace',
		async () => {
			const route = routeOfRoad(await roadOf('urnsee'));
			const world = generate(route);
			const lake = sceneOf('urnsee')!;
			const level = world.waters[0].level;
			let near = 0;
			let all = 0;
			const over: number[] = [];
			// The east shore: from the village's beach to the head of the lake, the tunnel aside.
			for (let d = 300; d < 4300; d += 100) {
				if (world.tunnels.some(([a, b]) => d >= a - 20 && d <= b + 20))
					continue;
				const p = at(route, d);
				all++;
				over.push(p.ele - level);
				for (let a = 0; a < 16; a++)
					if (
						lake.waterAt(
							p.x + 150 * Math.cos((a * Math.PI) / 8),
							p.z + 150 * Math.sin((a * Math.PI) / 8),
						) !== null
					) {
						near++;
						break;
					}
			}
			expect(near / all).toBeGreaterThan(0.8);
			// Now a few metres over the water, now high under the cliffs.
			expect(Math.min(...over)).toBeLessThan(5);
			expect(Math.max(...over)).toBeGreaterThan(20);
			expect(world.tunnels).toHaveLength(1);
			// The inlet's mouth, and the outlet under the terrace; a stream's short bridge aside.
			expect(world.bridges.filter(([a, b]) => b - a > 40)).toHaveLength(2);
			expect(world.galleries).toHaveLength(1);
			expect(world.galleries[0][1] - world.galleries[0][0]).toBeGreaterThan(
				300,
			);
			const top = Math.max(...route.ele);
			expect(top - level).toBeGreaterThan(100);
		},
		BUILD_MS,
	);
});

describe('Kettental-Runde', () => {
	it(
		'climbs to the alp past its lake, rides the ridge, and runs down the Kettental through its fields, over its river twice',
		async () => {
			const route = routeOfRoad(await roadOf('kette'));
			const world = generate(route);
			expect(route.length).toBeGreaterThan(48_000);
			expect(Math.max(...route.ele)).toBeGreaterThan(1900);
			// The alp's lake beside the road.
			const alp = world.waters.find((w) => !w.run && w.level > 1800)!;
			let byLake = 0;
			let fields = 0;
			for (let d = 0; d < route.length; d += 50) {
				const p = at(route, d);
				for (let a = 0; a < 16; a++)
					if (
						world.waterAt(
							p.x + 150 * Math.cos((a * Math.PI) / 8),
							p.z + 150 * Math.sin((a * Math.PI) / 8),
						) === alp.level
					) {
						byLake++;
						break;
					}
				for (const side of [-40, 40])
					if (
						world.biomeAt(
							p.x + Math.cos(p.heading) * side,
							p.z - Math.sin(p.heading) * side,
						) === Biome.Dry
					)
						fields++;
			}
			expect(byLake).toBeGreaterThan(3);
			// Ripe grain beside the valley road.
			expect(fields).toBeGreaterThan(30);
			// The valley's river, twice, each time on a bridge over it: a stream's short span aside.
			const kette = world.bridges.filter(([a, b]) => {
				if (b - a <= 40) return false;
				const mid = at(route, (a + b) / 2);
				return mid.x < -6000 && world.waterAt(mid.x, mid.z) !== null;
			});
			expect(kette).toHaveLength(2);
		},
		2 * BUILD_MS,
	);
});

describe('the map', () => {
	/** The map's loops: the Valley loop is a land of its own. */
	const LOOPS = DESIGNS.filter((d) => d.others);
	it(
		'is one land whichever loop is ridden: the same water, and the other loops’ roads where they leave this one',
		async () => {
			const worlds = await Promise.all(
				LOOPS.map(async (d) => {
					const route = routeOfRoad(await roadOf(d.id));
					return { id: d.id, route, world: generate(route) };
				}),
			);
			const [first, ...rest] = worlds;
			for (const { id, world } of rest) {
				// Its lake and its river lie where the first loop's do, to the metre.
				const still = (w: World) => w.waters.filter((k) => !k.run);
				expect(
					still(world).map((k) => k.level),
					id,
				).toEqual(still(first.world).map((k) => k.level));
				expect(still(world)[0].outline[0], id).toEqual(
					still(first.world)[0].outline[0],
				);
			}
			for (const { id, route, world } of worlds) {
				expect(world.sides.length, id).toBeGreaterThan(0);
				for (const side of world.sides) {
					// A side road is a road: long enough to be one, and its first sample lies on a road already there, this one or another kept before it.
					// (A roundabout's arm is 30 m by design.)
					expect(side.route.length, id).toBeGreaterThanOrEqual(
						side.square ? 30 : 40,
					);
					// Where it meets a road it ends at that road's edge, at that road's height, never inside it.
					side.mouths.forEach((m, end) => {
						if (!m) return;
						const at = end === 0 ? 0 : side.route.x.length - 1;
						expect(Math.abs(side.route.ele[at] - m.h), id).toBeLessThan(0.01);
					});
					expect(side.route.minEle, id).toBe(route.minEle);
				}
				// The ridden road and its side roads together are the whole map's roads: every loop's every 200 m lies on one of them.
				const lines = [route, ...world.sides.map((s) => s.route)];
				for (const other of worlds)
					for (let i = 0; i < other.route.x.length; i += 20) {
						let best = Infinity;
						for (const l of lines)
							for (let k = 0; k < l.x.length; k++)
								best = Math.min(
									best,
									Math.hypot(
										l.x[k] - other.route.x[i],
										l.z[k] - other.route.z[i],
									),
								);
						expect(best, `${id} draws ${other.id}`).toBeLessThan(18);
					}
			}
		},
		3 * BUILD_MS,
	);

	it(
		'ends no road rounded beside another: one that comes that near meets it at a junction',
		async () => {
			/** Metres from (x, z) to a road's line. */
			const off = (r: Route, x: number, z: number) => {
				let best = Infinity;
				for (let i = 0; i + 1 < r.x.length; i++) {
					const sx = r.x[i + 1] - r.x[i];
					const sz = r.z[i + 1] - r.z[i];
					const t = Math.min(
						1,
						Math.max(
							0,
							((x - r.x[i]) * sx + (z - r.z[i]) * sz) /
								(sx * sx + sz * sz || 1),
						),
					);
					best = Math.min(
						best,
						Math.hypot(r.x[i] + sx * t - x, r.z[i] + sz * t - z),
					);
				}
				return best;
			};
			let open = 0;
			for (const d of LOOPS) {
				const route = routeOfRoad(await roadOf(d.id));
				const world = generate(route);
				world.sides.forEach((side, k) => {
					if (side.square) return;
					const r = side.route;
					side.mouths.forEach((m, end) => {
						if (m) return;
						open++;
						const i = end === 0 ? 0 : r.x.length - 1;
						const near = Math.min(
							off(world.ridden, r.x[i], r.z[i]),
							...world.sides
								.filter((_, j) => j !== k)
								.map((s) => off(s.route, r.x[i], r.z[i])),
						);
						// A lane's end in the open lies far from any road; one that leaves a road at a shallow angle ended a car's length beside it.
						expect(
							near,
							`${d.id}: side road ${k}'s end ${end}`,
						).toBeGreaterThan(40);
					});
				});
			}
			expect(open).toBeGreaterThan(20);
		},
		5 * BUILD_MS,
	);

	it(
		'makes a junction of every mouth: the side road runs into the road it meets at its height, and what is painted on it lies on it, inside its lane, its stop line along the other road’s carriageway edge',
		async () => {
			/** Metres from (x, z) to a road's line, and which side of it: positive left. */
			const off = (r: Route, x: number, z: number) => {
				let best = Infinity;
				let side = 1;
				for (let i = 0; i + 1 < r.x.length; i++) {
					const sx = r.x[i + 1] - r.x[i];
					const sz = r.z[i + 1] - r.z[i];
					const px = x - r.x[i];
					const pz = z - r.z[i];
					const t = Math.min(
						1,
						Math.max(0, (px * sx + pz * sz) / (sx * sx + sz * sz)),
					);
					const d = Math.hypot(px - sx * t, pz - sz * t);
					if (d < best) {
						best = d;
						side = px * sz - pz * sx >= 0 ? 1 : -1;
					}
				}
				return best * side;
			};
			let mouths = 0;
			let painted = 0;
			for (const d of LOOPS) {
				const route = routeOfRoad(await roadOf(d.id));
				const world = generate(route);
				world.sides.forEach((side, k) =>
					side.mouths.forEach((m, end) => {
						if (!m) return;
						mouths++;
						const where = `${d.id}, side road ${k}, end ${end}`;
						const met = m.met === 0 ? route : world.sides[m.met - 1].route;
						const last = end === 0 ? 0 : side.route.x.length - 1;
						// Its end lies inside the other road's asphalt, which hides it, at that road's height.
						const reach = Math.abs(
							off(met, side.route.x[last], side.route.z[last]),
						);
						expect(reach, where).toBeLessThan(ROAD_W / 2 - 0.3);
						expect(Math.abs(side.route.ele[last] - m.h), where).toBeLessThan(
							0.01,
						);
						// Each road's paint reads the other's line there.
						expect(
							side.route.meets?.some((o) => o.role === JOINS),
							where,
						).toBe(true);
						const theirs = m.met === 0 ? world.ridden.meets : met.meets;
						expect(
							theirs?.some(
								(o) => o.role === JOINED && o.from < m.at && o.to > m.at,
							),
							where,
						).toBe(true);
						const surface = surfaceOf(side.route);
						// Onto a roundabout's ring nobody stops, nor out of a gravel lane: nothing is painted there.
						if (stopped(side, world.sides)[end] === null) return;
						const mouth = {
							...m,
							off: (x: number, z: number) => world.offJunction(m, x, z),
						};
						const paint = stops(
							[
								{
									length: side.route.length,
									surface,
									mouths: end === 0 ? [mouth, null] : [null, mouth],
								},
							],
							{ line: '#fff', sign: '#f00', post: '#888' },
						).getAttribute('position');
						const square = m.sx * m.tx + m.sz * m.tz;
						// A fork has no stop; a square mouth has one.
						expect(paint.count > 0, where).toBe(square >= SQUARE_COS);
						/** Across the incoming lane, where the paint's near edge lies: right of the centre line, metres. */
						const edge: number[] = [];
						for (let i = 0; i < paint.count; i++) {
							const [x, y, z] = [paint.getX(i), paint.getY(i), paint.getZ(i)];
							const u = off(side.route, x, z);
							// What is painted, not the sign on its post: within a hand of the road.
							// Its metre along the side road, between its samples.
							const along = (() => {
								let best = Infinity;
								let at = 0;
								const r = side.route;
								for (let j = 0; j + 1 < r.x.length; j++) {
									const sx = r.x[j + 1] - r.x[j];
									const sz = r.z[j + 1] - r.z[j];
									const t = Math.min(
										1,
										Math.max(
											0,
											((x - r.x[j]) * sx + (z - r.z[j]) * sz) /
												(sx * sx + sz * sz),
										),
									);
									const dd = Math.hypot(
										x - r.x[j] - sx * t,
										z - r.z[j] - sz * t,
									);
									if (dd < best) {
										best = dd;
										at = (j + t) * r.step;
									}
								}
								return at;
							})();
							const over = y - surface(along, u).y;
							if (Math.abs(u) > ROAD_W / 2) continue; // the sign, off the asphalt
							painted++;
							// On the road: a centimetre or two over it, never under it or floating.
							expect(over, where).toBeGreaterThan(-0.02);
							expect(over, where).toBeLessThan(0.05);
							// In the incoming lane: right of its centre line as the rider comes in, inside its edge line.
							const right = end === 0 ? u : -u;
							expect(right, where).toBeGreaterThan(0.1);
							expect(right, where).toBeLessThan(ROAD_W / 2 - 0.25);
							// And on its own asphalt, never on the road it meets: from that road's carriageway edge back.
							const toMet = world.offJunction(m, x, z);
							expect(toMet, where).toBeGreaterThan(STOP_LINE.off - 0.02);
							if (toMet < STOP_LINE.off + 0.02) edge.push(right);
						}
						if (paint.count === 0) return;
						// The stop line's near edge lies on the road met's carriageway edge, along it, the whole width of the lane: not back from it, and not square to the side road where it comes in askew.
						expect(Math.min(...edge), where).toBeLessThan(STOP_LANE.from);
						expect(Math.max(...edge), where).toBeGreaterThan(STOP_LANE.to);
					}),
				);
			}
			expect(mouths).toBeGreaterThan(20);
			expect(painted).toBeGreaterThan(1000);
		},
		3 * BUILD_MS,
	);

	it(
		'never draws the ground over a road: every road of every loop, ridden or not, lies on the land or over it',
		async () => {
			for (const d of LOOPS) {
				const route = routeOfRoad(await roadOf(d.id));
				const world = generate(route);
				const roads = [
					// A tunnel's hill stands over it: that is the tunnel.
					{
						name: 'ridden',
						r: route,
						spans: [...world.bridges, ...world.tunnels],
					},
					...world.sides.map((side, k) => ({
						name: `side road ${k}`,
						r: side.route,
						spans: [...side.bridges, ...side.tunnels],
					})),
				];
				for (const { name, r, spans } of roads)
					for (let m = 0; m <= r.length; m += 4) {
						if (spans.some(([a, b]) => m >= a - 12 && m <= b + 12)) continue;
						const p = at(r, m);
						for (const u of [0, 2.5, -2.5]) {
							const x = p.x + Math.cos(p.heading) * u;
							const z = p.z - Math.sin(p.heading) * u;
							// Another road may lie over this one where they meet; the land never does.
							expect(
								world.heightAt(x, z) - p.ele,
								`${d.id}, ${name}, ${Math.round(m)} m`,
							).toBeLessThan(0.1);
						}
					}
			}
		},
		3 * BUILD_MS,
	);

	it(
		'names each pass once, and the col is Col de Berne',
		async () => {
			const names = new Map<string, string[]>();
			for (const d of LOOPS) {
				const world = generate(routeOfRoad(await roadOf(d.id)));
				names.set(
					d.id,
					world.arches.map((a) => a.label),
				);
			}
			expect(names.get('berne')).toContain('KOM · COL DE BERNE');
			for (const [id, labels] of names)
				expect(new Set(labels).size, id).toBe(labels.length);
		},
		// Every loop's every tile: the map is five loops' land.
		8 * BUILD_MS,
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
			const fall = world.waters.find((w) => w.run && w.run.levels[0] > 1700)!;
			expect(fall.run!.foam.filter((f) => f > 0.5).length).toBeGreaterThan(30);
			expect(world.galleries).toHaveLength(1);
		},
		BUILD_MS,
	);
	it(
		'the lake and the gorge: a moor beside each road, and streams into the lake',
		async () => {
			for (const id of ['aare', 'urnsee']) {
				const route = routeOfRoad(await roadOf(id));
				const world = generate(route);
				expect(beside(route, world, Biome.Moor), id).toBeGreaterThan(8);
				const lake = world.waters.find((w) => !w.run)!.level;
				const into = world.waters.filter(
					(w) => w.run && w.run.levels[w.run.levels.length - 1] === lake,
				);
				expect(into.length, id).toBeGreaterThanOrEqual(3);
			}
		},
		BUILD_MS,
	);
});

describe('the map’s land', () => {
	const LOOPS = DESIGNS.filter((d) => d.others);
	const MAP = LOOPS[0];
	/** Metres from a spot on the map to a loop's line, and the metre along it. */
	const onLine = (line: Route, [x, y]: readonly [number, number]) => {
		let best = { d: Infinity, m: 0 };
		for (let i = 0; i < line.x.length; i++) {
			const d = Math.hypot(line.x[i] - x, -line.z[i] - y);
			if (d < best.d) best = { d, m: i * line.step };
		}
		return best;
	};

	it('has a lake with an island standing out of it, and shallows by the village', () => {
		const lake = MAP.features.find((f) => f.kind === 'lake')!;
		if (lake.kind !== 'lake') throw new Error('no lake');
		const scene = sceneOf(MAP.id)!;
		for (const isle of lake.islands ?? []) {
			const x = isle.reduce((s, p) => s + p[0], 0) / isle.length;
			const y = isle.reduce((s, p) => s + p[1], 0) / isle.length;
			expect(scene.waterAt(x, -y)).toBeNull();
			expect(scene.shape(x, -y, lake.level, 300)).toBeGreaterThan(
				lake.level + 2,
			);
		}
		expect(lake.islands?.length).toBeGreaterThan(0);
		// The bed off the beach lies shallower than as far off any other shore.
		const [bx, by] = lake.shallows![0].at;
		const beach = scene.shape(bx, -(by + 120), lake.level, 300);
		expect(lake.level - beach).toBeLessThan(8);
	});

	it.each(MAP.tunnels!.map((t, k) => [k, t] as const))(
		'bores tunnel %i through a hill on a loop’s road: the ground stands whole over it',
		async (_, [a, b]) => {
			const loop = LOOPS.find((d) => {
				const line = designedLine(d);
				return onLine(line, a).d < 6 && onLine(line, b).d < 6;
			});
			expect(loop).toBeDefined();
			const route = routeOfRoad(await roadOf(loop!.id));
			const world = generate(route);
			expect(world.tunnels).toHaveLength(1);
			const [from, to] = world.tunnels[0];
			// Portal to portal, read to the road's 10 m rows, and longer where the road winds.
			const straight = Math.hypot(b[0] - a[0], b[1] - a[1]);
			expect(to - from).toBeGreaterThan(straight - 10);
			expect(to - from).toBeLessThan(straight * 1.05 + 10);
			// The hill over its middle, well over the road: no cutting through it.
			const mid = at(route, (from + to) / 2);
			expect(world.heightAt(mid.x, mid.z) - mid.ele).toBeGreaterThan(15);
			// And at each portal the road is on its shelf, the hill rising from it.
			for (const d of [from - 12, to + 12]) {
				const p = at(route, d);
				expect(Math.abs(world.heightAt(p.x, p.z) - p.ele)).toBeLessThan(1.5);
			}
			for (const d of [from + 30, to - 30]) {
				const p = at(route, d);
				expect(world.heightAt(p.x, p.z) - p.ele).toBeGreaterThan(4);
			}
		},
		BUILD_MS,
	);

	// Wattalp's lanes, and the Valley's on a land of its own: its lanes start on its own loop, which no other loop shares.
	it.each([
		['urnsee', 15],
		['valley', 8],
	] as const)(
		'%s: lays gravel lanes on the land: narrow, with no stop or sign, never beside a road',
		async (id, least) => {
			const route = routeOfRoad(await roadOf(id));
			const world = generate(route);
			const lanes = world.sides.filter((s) => s.route.gravel);
			expect(lanes.length).toBeGreaterThan(least);
			const roads = [
				route,
				...world.sides.filter((s) => !s.route.gravel).map((s) => s.route),
			];
			for (const lane of lanes) {
				const r = lane.route;
				expect(ribbonOf(r).width).toBe(GRAVEL_W);
				expect(stopped(lane, world.sides)).toEqual([null, null]);
				for (let m = 0; m <= r.length; m += 20) {
					const p = at(r, m);
					// On its land, off its bridges: the field or the hillside 15 m either side lies about as high, no cutting or bank of its own.
					if (!lane.bridges.some(([f, t]) => m >= f - 30 && m <= t + 30))
						for (const side of [-15, 15])
							expect(
								Math.abs(
									world.heightAt(
										p.x + Math.cos(p.heading) * side,
										p.z - Math.sin(p.heading) * side,
									) - p.ele,
								),
								`${Math.round(p.x)}, ${Math.round(p.z)}`,
							).toBeLessThan(10);
					// Away from where it meets one, never running beside a road.
					if (m < 80 || m > r.length - 80) continue;
					let near = Infinity;
					for (const o of roads)
						for (let i = 0; i < o.x.length; i += 2)
							near = Math.min(near, Math.hypot(o.x[i] - p.x, o.z[i] - p.z));
					expect(
						near,
						`${Math.round(p.x)}, ${Math.round(p.z)}`,
					).toBeGreaterThan(20);
				}
			}
		},
		3 * BUILD_MS,
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
		'has snow peaks over the col',
		async () => {
			const route = routeOfRoad(await roadOf('berne'));
			const world = generate(route);
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

describe('what stands along the map’s roads', () => {
	/** The map's loops, each with the other loops' roads where they meet it. */
	const LOOPS = DESIGNS.filter((d) => d.others);
	it.each(LOOPS.map((d) => [d.id] as const))(
		'%s stands nothing on another road, in a junction’s mouth, or through a gallery',
		async (id) => {
			const { indexLines } = await import('./terrain/lines');
			const { FORMATION } = await import('./terrain/road-profile');
			const { kitSpec } = await import('./props/kit');
			const { ART, reach, roadsidePlacer, BLOCK_M } =
				await import('./roadside-place');
			const route = routeOfRoad(await roadOf(id));
			const world = generate(route);
			// The ground's own order of its lines (terrain/lines.ts canonical), which a piece's `line` counts in.
			const lines = [...world.roads].sort((a, b) =>
				a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
			);
			const index = indexLines(lines);
			// A mouth counts roads as the world lists them: the road ridden, then each side road.
			const lineOf = (road: number) =>
				lines.findIndex((l) => l.key === world.roads[road].key);
			const where = (x: number, z: number) =>
				`${id} at ${Math.round(x)}, ${Math.round(z)}`;
			/** Metres from (x, z) to the nearest road but `skip`. */
			const off = (x: number, z: number, skip = -1) =>
				index.nearest(x, z, 2, skip)?.d ?? Infinity;
			const MARGIN = 0.5;
			const bad: string[] = [];

			const stood = world.everything;
			for (const { piece, line } of stood.standing)
				if (off(piece.x, piece.z, line) < FORMATION + MARGIN)
					bad.push(
						`${piece.kind} of ${lines[line].key} ${where(piece.x, piece.z)}`,
					);
			// A sign stands past its own road's formation as well as every other's: a pass's 5.2 m from its road's centre.
			for (const s of stood.signs)
				if (off(s.x, s.z) < FORMATION + 0.3)
					bad.push(`${s.look} sign ${where(s.x, s.z)}`);
			for (const a of stood.arches) {
				const own = index.lineOf[index.nearest(a.x, a.z, 1)!.i];
				const [ax, az] = a.turn;
				for (const hand of [-1, 1]) {
					const x = a.x + az * 4.4 * hand;
					const z = a.z - ax * 4.4 * hand;
					if (off(x, z, own) < FORMATION + MARGIN)
						bad.push(`arch post ${where(x, z)}`);
				}
			}
			for (const p of stood.props)
				if (off(p.x, p.z) < FORMATION + MARGIN)
					bad.push(`${p.kind} ${where(p.x, p.z)}`);

			// The road met keeps its own things out of a side road's mouth: within 12 m of it, on its side.
			for (const side of world.sides)
				for (const m of side.mouths) {
					if (!m) continue;
					const met = lineOf(m.met);
					for (const { piece, line } of stood.standing) {
						if (line !== met) continue;
						const dx = piece.x - m.x;
						const dz = piece.z - m.z;
						if (Math.hypot(dx, dz) < 12 && dx * m.tx + dz * m.tz < m.d)
							bad.push(`${piece.kind} in a mouth ${where(piece.x, piece.z)}`);
					}
				}

			// Nothing reaches through a gallery's wall or roof, or in between its pillars.
			const placer = roadsidePlacer(route, world);
			const spots = Array.from(
				{ length: Math.ceil(route.length / BLOCK_M) },
				(_, b) => placer.spots(b),
			).flat();
			const things = [
				...spots.map((s) => ({
					x: s.x,
					z: s.z,
					r: reach(s.art),
					what: ART[s.art].name,
				})),
				...stood.props.map((p) => {
					const k = kitSpec(p.kind);
					return {
						x: p.x,
						z: p.z,
						r: (Math.hypot(k.hw, k.hd) + Math.hypot(k.cx, k.cz)) * p.scale,
						what: p.kind,
					};
				}),
			];
			for (const [from, to] of world.galleries) {
				const along: [number, number][] = [];
				for (let d = from; d <= to; d += 1) {
					const p = at(route, d);
					along.push([p.x, p.z]);
				}
				for (const t of things) {
					const d = Math.min(
						...along.map(([x, z]) => Math.hypot(t.x - x, t.z - z)),
					);
					if (d < FORMATION + 0.9 + t.r)
						bad.push(
							`${t.what} ${d.toFixed(1)} m from a gallery's road ${where(t.x, t.z)}`,
						);
				}
			}
			for (const s of spots)
				if (off(s.x, s.z) < FORMATION)
					bad.push(`${ART[s.art].name} on a road ${where(s.x, s.z)}`);
			// Nor on a roundabout: its island, an arm where it flares wider than a road's formation, or the signs before an arm.
			for (const ring of roundaboutsOf(id))
				for (const t of things) {
					const dx = t.x - ring.x;
					const dz = t.z - ring.z;
					if (Math.hypot(dx, dz) < ring.r)
						bad.push(`${t.what} on an island ${where(t.x, t.z)}`);
					for (const arm of ring.arms) {
						const m = dx * arm[0] + dz * arm[1] - ring.r;
						const across = Math.abs(dz * arm[0] - dx * arm[1]);
						if (m >= 0 && m <= ARM_M && across < FORMATION * armWiden(m) + t.r)
							bad.push(`${t.what} on a flared arm ${where(t.x, t.z)}`);
						const sign = ringSignAt(ring, arm);
						if (Math.hypot(t.x - sign.x, t.z - sign.z) < t.r + 0.3)
							bad.push(`${t.what} on a roundabout sign ${where(t.x, t.z)}`);
					}
				}
			expect(bad).toEqual([]);
		},
		6 * BUILD_MS,
	);
});

describe('a roundabout', () => {
	// Its rings and arms are the map's: every loop draws all of them, and the Flèche du Lac rides through both.
	let world: World;
	let id: string;
	beforeAll(async () => {
		id = 'lac';
		world = generate(routeOfRoad(await roadOf(id)));
	}, BUILD_MS);

	/** Each ring as the world draws it, with its arms: unit vector, the arm's route, and a point `a` metres out from the centre and `u` across. */
	const rings = () =>
		roundaboutsOf(id).map((ring) => {
			const route = world.sides.find(
				(s) =>
					s.route.loop &&
					s.route.level &&
					Math.abs(
						Math.hypot(s.route.x[0] - ring.x, s.route.z[0] - ring.z) - ring.r,
					) < 0.5,
			)!.route;
			const arms = ring.arms.map((v) => ({
				v,
				route: world.sides.find(
					(s) =>
						s.route.widen &&
						Math.hypot(
							s.route.x[0] - (ring.x + v[0] * ring.r),
							s.route.z[0] - (ring.z + v[1] * ring.r),
						) < 0.5,
				)!.route,
			}));
			const point = (v: readonly [number, number], a: number, u: number) => ({
				x: ring.x + v[0] * a - v[1] * u,
				z: ring.z + v[1] * a + v[0] * u,
			});
			return { ...ring, route, arms, point };
		});

	/** Points round each arm's mouth: from `band[0]` to `band[1]` metres out past the ring's centre line, every 0.2 m, at every degree within 50° of the arm. */
	function* mouths(band: [number, number]) {
		for (const ring of rings())
			for (const arm of ring.arms)
				for (let deg = -50; deg <= 50; deg++)
					for (let r = band[0]; r <= band[1] + 1e-9; r += 0.2) {
						const t = (deg * Math.PI) / 180;
						const u = (ring.r + r) * Math.sin(t);
						const along = (ring.r + r) * Math.cos(t);
						yield {
							ring,
							arm,
							m: along - ring.r,
							u,
							...ring.point(arm.v, along, u),
						};
					}
	}
	const asphalt = (m: number) => (ROAD_W / 2) * armWiden(m);

	it('gives up its ring’s shoulder only under an arm’s asphalt: no ground between the two', () => {
		const bad: string[] = [];
		for (const p of mouths([ROAD_W / 2 + 0.05, FORMATION - 0.05])) {
			const [o, as] = meetingAt(p.ring.route, 0, p.x, p.z);
			const givenUp = as === JOINED && o < ROAD_W / 2 - 0.15;
			// Under this arm's asphalt or a neighbour's: a node's arms may leave 50° apart.
			const under = p.ring.arms.some((arm) => {
				const dx = p.x - p.ring.x;
				const dz = p.z - p.ring.z;
				const m = dx * arm.v[0] + dz * arm.v[1] - p.ring.r;
				return (
					m > -ROAD_W / 2 &&
					Math.abs(dz * arm.v[0] - dx * arm.v[1]) < asphalt(Math.max(0, m))
				);
			});
			if (givenUp && !under)
				bad.push(
					`${p.ring.statue}: ${p.u.toFixed(2)} m across, ${p.m.toFixed(2)} m out`,
				);
		}
		expect(bad.slice(0, 5)).toEqual([]);
	});

	it('draws an arm’s asphalt to the ring’s and its shoulder from there out', () => {
		const bad: string[] = [];
		for (const p of mouths([ROAD_W / 2 + 0.05, FORMATION + 3])) {
			if (p.m < 0 || Math.abs(p.u) >= FORMATION * armWiden(p.m)) continue;
			const [o, as] = meetingAt(p.arm.route, p.m, p.x, p.z);
			const shoulder = Math.abs(p.u) >= asphalt(p.m);
			// The shader's own cuts (geometry.ts roadMaterial): asphalt inside the ring's, a shoulder inside its formation.
			const cut =
				as === JOINS && (o < ROAD_W / 2 - 0.1 || (shoulder && o < FORMATION));
			if (cut)
				bad.push(
					`${p.ring.statue}: ${shoulder ? 'shoulder' : 'asphalt'} ${p.u.toFixed(2)} m across, ${p.m.toFixed(2)} m out`,
				);
		}
		expect(bad.slice(0, 5)).toEqual([]);
	});

	it('dashes the ring’s edge line across the whole of each mouth', () => {
		const bad: string[] = [];
		const line = ROAD_W / 2 - 0.25;
		for (const ring of rings())
			for (const arm of ring.arms)
				for (let deg = -30; deg <= 30; deg += 0.5) {
					const t = (deg * Math.PI) / 180;
					const u = (ring.r + line) * Math.sin(t);
					const along = (ring.r + line) * Math.cos(t);
					// To a hand short of where the arm's own edge line comes in.
					if (
						Math.abs(u) >
						(ROAD_W / 2 - 0.25) * armWiden(along - ring.r) - 0.3
					)
						continue;
					const p = ring.point(arm.v, along, u);
					const [o, as] = meetingAt(ring.route, 0, p.x, p.z);
					if (!(as === JOINED && o < ROAD_W / 2 - 0.6))
						bad.push(`${ring.statue}: solid ${u.toFixed(2)} m across`);
				}
		expect(bad.slice(0, 5)).toEqual([]);
	});

	it('paints the give-way line across each way in, off the ring and inside the lane', () => {
		const all = rings();
		const g = giveWays(
			all,
			all.flatMap((ring) =>
				ring.arms.map((arm) => ({
					route: arm.route,
					surface: surfaceOf(arm.route, liftOf(arm.route, false)),
				})),
			),
			'#fff',
		);
		const pos = g.getAttribute('position');
		expect(pos.count).toBeGreaterThan(0);
		const lanes = new Set<string>();
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const z = pos.getZ(i);
			const ring = all.find((k) => Math.hypot(x - k.x, z - k.z) < k.r + 6)!;
			const r = Math.hypot(x - ring.x, z - ring.z) - ring.r;
			expect(r).toBeGreaterThan(ROAD_W / 2);
			expect(r).toBeLessThan(FORMATION);
			// The arm it lies across: the one it lies most nearly along, out from the centre.
			const along = (k: (typeof ring.arms)[number]) =>
				(x - ring.x) * k.v[0] + (z - ring.z) * k.v[1];
			const arm = ring.arms.reduce((a, b) => (along(b) > along(a) ? b : a));
			// Left of the arm's way out: a rider coming in has it on the right, short of the edge line.
			const u = (x - ring.x) * arm.v[1] - (z - ring.z) * arm.v[0];
			const m = (x - ring.x) * arm.v[0] + (z - ring.z) * arm.v[1] - ring.r;
			expect(u).toBeGreaterThan(0);
			expect(u).toBeLessThan((ROAD_W / 2 - 0.25) * armWiden(m));
			lanes.add(`${ring.statue}:${arm.v.join()}`);
		}
		expect(lanes.size).toBe(all.reduce((n, k) => n + k.arms.length, 0));
	});

	it(
		'lays the road ridden level where it laps an arm: no edge of it stands through the arm’s asphalt',
		async () => {
			const bad: string[] = [];
			for (const d of DESIGNS.filter((k) => k.rings)) {
				const w =
					d.id === id ? world : generate(routeOfRoad(await roadOf(d.id)));
				const ridden = w.ridden;
				const surface = surfaceOf(ridden, ROAD_LIFT);
				for (const ring of roundaboutsOf(d.id))
					for (const v of ring.arms) {
						const arm = w.sides.find(
							(s) =>
								s.route.widen &&
								Math.hypot(
									s.route.x[0] - (ring.x + v[0] * ring.r),
									s.route.z[0] - (ring.z + v[1] * ring.r),
								) < 0.5,
						)!.route;
						const armAt = surfaceOf(arm, liftOf(arm, false));
						for (let m = 0; m <= ridden.length; m += 2) {
							if (sharedAt(ridden, m) >= 1) continue;
							const c = at(ridden, m);
							const dx = c.x - ring.x;
							const dz = c.z - ring.z;
							const out = dx * v[0] + dz * v[1] - ring.r;
							if (out < 0 || out > ARM_M || Math.abs(dz * v[0] - dx * v[1]) > 1)
								continue;
							for (const u of [-3, -1.5, 0, 1.5, 3]) {
								const p = surface(m, u);
								const q = armAt(out, 0);
								// A centimetre either way is the two roads' own heights; banked into the turn onto the ring, its edge stood 0.2 m over.
								if (p.y > q.y + 0.03)
									bad.push(
										`${d.id} ${Math.round(m)} m, ${u} m across: ${(p.y - q.y).toFixed(2)} m over the arm`,
									);
							}
						}
					}
			}
			expect(bad.slice(0, 5)).toEqual([]);
		},
		4 * BUILD_MS,
	);
});
