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
import { JOINED, JOINS } from './crossings';
import { surfaceOf } from './geometry';
import { SQUARE_COS, stops } from './scenery';
import { ROAD_W } from './terrain/road-profile';
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
			BUILD_MS,
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
		'runs along its lake, through a gallery, over an inlet and the outlet, and looks down on it from its terrace',
		async () => {
			const route = routeOfRoad(await roadOf('urnsee'));
			const world = generate(route);
			const lake = sceneOf('urnsee')!;
			let near = 0;
			let all = 0;
			// The east shore: from its first kilometre to the head of the lake.
			for (let d = 700; d < 3700; d += 100) {
				const p = at(route, d);
				all++;
				for (let a = 0; a < 16; a++)
					if (
						lake.waterAt(
							p.x + 90 * Math.cos((a * Math.PI) / 8),
							p.z + 90 * Math.sin((a * Math.PI) / 8),
						) !== null
					) {
						near++;
						break;
					}
			}
			expect(near / all).toBeGreaterThan(0.8);
			expect(world.bridges).toHaveLength(2);
			expect(world.galleries).toHaveLength(1);
			expect(world.galleries[0][1] - world.galleries[0][0]).toBeGreaterThan(
				300,
			);
			const top = Math.max(...route.ele);
			expect(top - world.waters[0].level).toBeGreaterThan(100);
		},
		BUILD_MS,
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
		'makes a junction of every mouth: the side road runs into the road it meets at its height, and what is painted on it lies on it, inside its lane, clear of the other road',
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
						// Onto a roundabout's ring nobody stops: nothing is painted there.
						if (met.level) return;
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
							// And clear of the road it meets: outside its painted shoulder.
							expect(world.offJunction(m, x, z), where).toBeGreaterThan(
								ROAD_W / 2 + 0.9,
							);
						}
					}),
				);
			}
			expect(mouths).toBeGreaterThan(20);
			expect(painted).toBeGreaterThan(1000);
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
		3 * BUILD_MS,
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
			expect(bad).toEqual([]);
		},
		6 * BUILD_MS,
	);
});
