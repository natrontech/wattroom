import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { hairpinPass, legsRoad } from '#lib/road/fixtures.ts';
import { toRoute } from '#lib/road/route.ts';
import { at } from '#lib/road/along.ts';
import type { Route } from '#lib/road/route.ts';
import { sceneOf } from './designed';
import { yOf } from './geometry';
import { climateOf } from './land';
import { roadIndex } from './field';
import { makeRig } from './rig';
import { routeOfRoad } from './road-route';
import type { SimRider } from './sim';
import {
	GALLERY,
	GALLERY_BACK,
	PORTAL,
	PORTAL_M,
	TUBE,
} from './structure-sizes';
import { liftOf } from './road-surface';
import {
	BRIDGE,
	bridgeKind,
	edgesOf,
	framer,
	galleries,
	Pieces,
	roadEdges,
	STONE_UNDER_SNOW_M,
	stoneFromOf,
	tunnels,
} from './structures';
import { makeGround } from './terrain/ground';
import { FORMATION } from './terrain/road-profile';
import type { Line } from './terrain/lines';
import { generate, withCulverts, type World } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * What is built along a designed road (structures.ts): which bridge a span
 * gets, where the pass road's granite stands instead of steel, and a
 * tunnel's hill left standing over it with nothing in it or before it.
 */

const routeOf = async (id: string) =>
	routeOfRoad((await homeRoute(HOME_ROADS.find((r) => r.id === id)!)).road);

describe('a bridge by its span', () => {
	it('is a slab over a stream, girders when low or short, a box girder when long and high, arches over a gorge', () => {
		expect(bridgeKind(22, 3)).toBe('slab');
		expect(bridgeKind(BRIDGE.slab, 30)).toBe('slab');
		expect(bridgeKind(56, 10)).toBe('beam');
		expect(bridgeKind(128, 35)).toBe('beam');
		expect(bridgeKind(314, 22)).toBe('beam');
		expect(bridgeKind(286, 45)).toBe('box');
		expect(bridgeKind(566, 126)).toBe('arch');
	});

	it('keeps a stream’s culvert out of a tunnel and from under a gallery’s roof, and joins one that runs into a bridge', () => {
		expect(withCulverts([[100, 200]], [[190, 214]], [])).toEqual([[100, 214]]);
		expect(withCulverts([], [[500, 522]], [[480, 900]])).toEqual([]);
		expect(withCulverts([], [[500, 522]], [], [[520, 800]])).toEqual([]);
		// A bridge under a gallery's roof stands; only a culvert gives way to the roof.
		expect(withCulverts([[500, 600]], [], [], [[520, 800]])).toEqual([
			[500, 600],
		]);
	});
});

describe('the ground over a tunnel (Line.bore)', () => {
	// A straight road 600 m long at 1,000 m, its middle 300 m bored through.
	const n = 301;
	const line: Line = {
		key: 'route',
		x: Float64Array.from({ length: n }, (_, i) => i * 2),
		z: new Float64Array(n),
		h: new Float64Array(n).fill(1000),
		bore: Uint8Array.from({ length: n }, (_, i) =>
			i >= 75 && i <= 225 ? 1 : 0,
		),
	};
	const bored = makeGround([line], { salt: [1, 2, 3, 4] });
	const open = makeGround([{ ...line, bore: undefined }], {
		salt: [1, 2, 3, 4],
	});

	it('stands over the road through the hill, as the drawn ground too, never cut down to it', () => {
		for (const x of [160, 300, 440]) {
			expect(bored.heightAt(x, 0)).toBeGreaterThan(1000 + TUBE.crown / 1.2);
			expect(bored.drawnAt(x, 0)).toBeGreaterThan(1000 + TUBE.crown / 1.2);
			// Beside the tube too, so a 10 m cell's straight line never dips into its vault.
			expect(bored.heightAt(x, TUBE.half + 6)).toBeGreaterThan(
				1000 + TUBE.crown / 1.2,
			);
		}
	});

	it('is the road’s own shelf before the hill, as it is with no tunnel', () => {
		for (const x of [40, 100, 560])
			expect(bored.heightAt(x, 0)).toBeCloseTo(open.heightAt(x, 0), 6);
	});
});

describe('Col de Berne', () => {
	let route: Route;
	let world: World;
	let stoneFrom: number;
	beforeAll(async () => {
		route = await routeOf('berne');
		world = generate(route);
		stoneFrom = sceneOf(route.scene)!.climate.snowline! - STONE_UNDER_SNOW_M;
	}, BUILD_MS);
	const skip = () => [...world.bridges, ...world.galleries, ...world.tunnels];

	it(
		'lines its mountain stretches with granite, parapets, retaining walls and guard stones, and nowhere under them',
		() => {
			const runs = edgesOf(route, world.groundAt, skip(), stoneFrom);
			const kinds = new Set(runs.map((r) => r.edge));
			expect([...kinds].sort()).toEqual(['guard', 'parapet', 'wall']);
			for (const r of runs) {
				const high = [r.from, (r.from + r.to) / 2, r.to].every(
					(d) => at(route, d).ele >= stoneFrom,
				);
				expect(high, `${r.edge} at ${r.from} m`).toBe(true);
			}
			// The same road with no mountain to it: steel where it falls away, no granite.
			const low = edgesOf(route, world.groundAt, skip(), Infinity);
			expect(low.every((r) => r.edge === 'rail')).toBe(true);
			expect(low.length).toBeGreaterThan(0);
		},
		BUILD_MS,
	);

	it('puts no granite or rail on a bridge, in a gallery or a tunnel', () => {
		const runs = edgesOf(route, world.groundAt, skip(), stoneFrom);
		for (const [a, b] of skip())
			for (const r of runs)
				expect(
					r.to <= a || r.from >= b,
					`${r.edge} ${r.from}–${r.to} over ${a}–${b}`,
				).toBe(true);
	});

	it('runs a tunnel through the hill by the tarn, the ground closed over it and cut before its portals', () => {
		expect(world.tunnels).toHaveLength(1);
		const [from, to] = world.tunnels[0];
		expect(to - from).toBeGreaterThan(200);
		for (let d = from + PORTAL_M + 10; d < to - PORTAL_M - 10; d += 20) {
			const p = at(route, d);
			expect(world.groundAt(p.x, p.z) - p.ele, `${d} m`).toBeGreaterThan(
				TUBE.crown / 1.2,
			);
		}
		for (const d of [from - 20, to + 20]) {
			const p = at(route, d);
			expect(Math.abs(world.groundAt(p.x, p.z) - p.ele), `${d} m`).toBeLessThan(
				1.5,
			);
		}
		// No stream's bridge in it.
		expect(world.bridges.some(([a, b]) => a < to && b > from)).toBe(false);
	});

	it(
		'stands nothing in its tunnel or before a portal: no tree, no post, no sign',
		() => {
			const [from, to] = world.tunnels[0];
			const line: { x: number; z: number }[] = [];
			for (let d = from - PORTAL.clear; d <= to + PORTAL.clear; d += 2)
				line.push(at(route, d));
			const off = (x: number, z: number) =>
				Math.min(...line.map((p) => Math.hypot(p.x - x, p.z - z)));
			const mid = at(route, (from + to) / 2);
			const seen = new Set<string>();
			let things = 0;
			for (const [ti, tj] of world.tilesWithin(
				mid.x,
				mid.z,
				(to - from) / 2 + 300,
			)) {
				if (seen.has(`${ti}:${tj}`)) continue;
				seen.add(`${ti}:${tj}`);
				const t = world.tile(ti, tj);
				for (const p of [...t.props, ...t.pieces, ...t.signs, ...t.arches]) {
					things++;
					expect(
						off(p.x, p.z),
						`${'kind' in p ? p.kind : 'board'} at ${p.x}, ${p.z}`,
					).toBeGreaterThan(PORTAL.half);
				}
			}
			expect(things).toBeGreaterThan(0);
		},
		BUILD_MS,
	);

	it('keeps the chase and the overhead camera under its vault, over the road', () => {
		const to = world.tunnels[0][1];
		const camera = new THREE.PerspectiveCamera();
		const rig = makeRig(route, world);
		const you = new THREE.Vector3();
		for (const mode of ['chase', 'heli'] as const) {
			rig.reset();
			// Ridden at 8 m/s, 30 frames a second: the eye follows as it would.
			for (let d = to - 120; d < to - 24; d += 8 / 30) {
				const p = at(route, d);
				you.set(p.x, yOf(route, p.ele) + 1, p.z);
				rig.update(camera, mode, { d, v: 8 } as SimRider, you, 1 / 30);
			}
			// In the tube, between the road there and its vault.
			const roof = world.roofAt(camera.position.x, camera.position.z);
			expect(roof?.floor, mode).toBeTypeOf('number');
			expect(camera.position.y, mode).toBeLessThan(roof!.floor! + TUBE.crown);
			expect(camera.position.y, mode).toBeGreaterThan(roof!.floor! + 1);
		}
	});

	it('closes each gallery’s mouths from the wall into the hill and under its bank, down to the ground', () => {
		const colors = {
			stone: '#888',
			concrete: '#aaa',
			steel: '#999',
			dark: '#333',
			lamp: '#fff',
			band: '#ff0',
			earth: '#0f0',
			snow: '#fff',
		};
		// The pass road's gallery, and the east shore's on another loop's road: the Urnersee's, drawn from here.
		const roads = [
			{
				r: route,
				lift: undefined as number | undefined,
				spans: world.galleries,
			},
			...world.sides
				.filter((s) => s.galleries.length > 0)
				.map((s) => ({
					r: s.route,
					lift: liftOf(s.route, false),
					spans: s.galleries,
				})),
		];
		expect(roads.length).toBe(2);
		const E = FORMATION + GALLERY.out;
		for (const { r, lift, spans } of roads) {
			const out = new Pieces();
			galleries(out, 'g', r, world.groundAt, spans, undefined, colors, lift);
			const tris: THREE.Vector3[][] = [];
			for (const g of out.geometries().values()) {
				const pos = g.attributes.position.array;
				for (let t = 0; t < pos.length; t += 9)
					tris.push(
						[0, 3, 6].map(
							(k) =>
								new THREE.Vector3(pos[t + k], pos[t + k + 1], pos[t + k + 2]),
						),
					);
			}
			const frame = framer(r, lift);
			for (const [from, to] of spans) {
				const mid = at(r, (from + to) / 2);
				const lx = Math.cos(mid.heading);
				const lz = -Math.sin(mid.heading);
				const over = (side: number) =>
					world.groundAt(mid.x + lx * side * 60, mid.z + lz * side * 60);
				const back = over(1) >= over(-1) ? 1 : -1;
				for (const d of [from, to]) {
					const f = frame(d);
					// The faces in the mouth's plane, as (metres left, height).
					const flat = tris
						.filter((t) =>
							t.every(
								(p) => Math.abs((p.x - f.x) * f.tx + (p.z - f.z) * f.tz) < 0.02,
							),
						)
						.map((t) =>
							t.map((p) => [(p.x - f.x) * f.lx + (p.z - f.z) * f.lz, p.y]),
						);
					const inside = (u: number, y: number) =>
						flat.some(([a, b, c]) => {
							const s = (p: number[], q: number[]) =>
								(q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (u - p[0]);
							const [d1, d2, d3] = [s(a, b), s(b, c), s(c, a)];
							return !(
								(d1 < 0 || d2 < 0 || d3 < 0) &&
								(d1 > 0 || d2 > 0 || d3 > 0)
							);
						});
					const gaps: string[] = [];
					// From the wall's face into the hill, past the roof's back and under the bank, the ground to the roof's underside.
					for (let k = E + 0.1; k <= E + GALLERY_BACK + 1.5; k += 0.3) {
						const u = back * k;
						const p = f.pt(u, 0);
						const ground = yOf(r, world.groundAt(p.x, p.z));
						for (
							let y = ground + 0.3;
							y < f.pt(u, GALLERY.clear - 0.2).y;
							y += 0.3
						)
							if (!inside(u, y))
								gaps.push(`${k.toFixed(1)} m in, ${(y - f.y).toFixed(1)} m up`);
					}
					expect(gaps, `the mouth at ${d.toFixed(0)} m`).toEqual([]);
				}
			}
		}
	});

	it('keeps its gallery’s earth on the roof and behind it, and its ribs off the roof’s underside', () => {
		const out = new Pieces();
		const colors = {
			stone: '#888',
			concrete: '#aaa',
			steel: '#999',
			dark: '#333',
			lamp: '#fff',
			band: '#ff0',
			earth: '#0f0',
			snow: '#fff',
		};
		expect(world.galleries).toHaveLength(1);
		const [from, to] = world.galleries[0];
		galleries(
			out,
			'route',
			route,
			world.groundAt,
			world.galleries,
			undefined,
			colors,
		);
		const frame = framer(route);
		const frames: ReturnType<typeof frame>[] = [];
		for (let d = from - 2; d <= to + 2; d += 0.5) frames.push(frame(d));
		/** A point's metres left of the road, and over its surface there. */
		const across = (x: number, y: number, z: number) => {
			let f = frames[0];
			let best = Infinity;
			for (const g of frames) {
				const d = Math.abs((x - g.x) * g.tx + (z - g.z) * g.tz);
				if (d < best) [best, f] = [d, g];
			}
			const u = (x - f.x) * f.lx + (z - f.z) * f.lz;
			return { u, over: y - f.pt(u, 0).y };
		};
		const rib = new THREE.Color('#aaa').multiplyScalar(1 - 0.09 * 0.9);
		const roofTop = GALLERY.clear + GALLERY.thick;
		let earth = 0;
		let ribs = 0;
		for (const g of out.geometries().values()) {
			const pos = g.attributes.position.array;
			const col = g.attributes.color.array;
			for (let t = 0; t < pos.length; t += 9) {
				const v = [0, 3, 6].map(
					(k) => new THREE.Vector3(pos[t + k], pos[t + k + 1], pos[t + k + 2]),
				);
				const c = new THREE.Color(col[t], col[t + 1], col[t + 2]);
				const isEarth = c.r === 0 && c.g === 1 && c.b === 0;
				const isRib = Math.abs(c.r - rib.r) < 1e-4;
				if (!isEarth && !isRib) continue;
				const n = new THREE.Vector3()
					.subVectors(v[1], v[0])
					.cross(new THREE.Vector3().subVectors(v[2], v[0]))
					.normalize();
				for (let i = 0; i <= 4; i++)
					for (let j = 0; j <= 4 - i; j++) {
						const p = v[0]
							.clone()
							.multiplyScalar(1 - (i + j) / 4)
							.addScaledVector(v[1], i / 4)
							.addScaledVector(v[2], j / 4);
						const { u, over } = across(p.x, p.y, p.z);
						// Over the road, between its pillars and its wall, the earth lies on the roof: none hangs into the opening.
						if (isEarth && Math.abs(u) < FORMATION + GALLERY.out) {
							earth++;
							expect(over, `earth ${u.toFixed(1)} m across`).toBeGreaterThan(
								roofTop - 0.2,
							);
						}
						// A rib's top runs well up into the slab, never a hair over its underside.
						if (isRib && Math.abs(n.y) > 0.99) {
							ribs++;
							expect(
								Math.abs(over - GALLERY.clear),
								`rib ${u.toFixed(1)} m across`,
							).toBeGreaterThan(0.1);
						}
					}
			}
		}
		expect(earth).toBeGreaterThan(100);
		expect(ribs).toBeGreaterThan(100);
	});

	it('builds the tunnel and the granite into pieces along the road', () => {
		const colors = {
			stone: '#888',
			concrete: '#aaa',
			steel: '#999',
			dark: '#333',
			lamp: '#fff',
			band: '#ff0',
			earth: '#0f0',
			snow: '#fff',
		};
		const out = new Pieces();
		tunnels(out, 'route', route, undefined, world.tunnels, colors);
		roadEdges(out, 'route', route, world.groundAt, skip(), stoneFrom, colors);
		const pieces = out.geometries();
		expect(pieces.size).toBeGreaterThan(10);
		// Each piece is culled on its own: none reaches across the map.
		for (const g of pieces.values())
			expect(g.boundingSphere!.radius).toBeLessThan(400);
		// The road's works stay a modest share of the frame's 400k triangles, whole.
		expect(out.triangles).toBeLessThan(80_000);
	});

	it('marks the pass road above the snowline with yellow and black poles, the ridden road only, and its orange poles below', () => {
		const snowline = sceneOf(route.scene)!.climate.snowline!;
		const seen = new Map<string, [number, number]>();
		for (let d = 9000; d < 18_000; d += 100) {
			const p = at(route, d);
			for (const t of world.tilesWithin(p.x, p.z, 300))
				seen.set(`${t[0]}:${t[1]}`, t);
		}
		const pieces = [...seen.values()].flatMap(
			([ti, tj]) => world.tile(ti, tj).pieces,
		);
		const { nearest } = roadIndex(route);
		const onRoad = (x: number, z: number) => {
			const hit = nearest(x, z);
			return hit && hit.d < 6 ? at(route, (hit.i + hit.t) * route.step) : null;
		};
		const markers = pieces.filter((p) => p.kind === 'marker');
		expect(markers.length).toBeGreaterThan(40);
		for (const m of markers) {
			const p = onRoad(m.x, m.z);
			expect(
				p,
				`a marker off the ridden road at ${m.x}, ${m.z}`,
			).not.toBeNull();
			expect(p!.ele).toBeGreaterThan(snowline - 5);
		}
		// Beside the ridden road over the snow, no orange pole: the markers stand there instead.
		const orange = pieces.filter((p) => {
			if (p.kind !== 'snowpole') return false;
			const at = onRoad(p.x, p.z);
			return at !== null && at.ele > snowline + 20;
		});
		expect(orange).toEqual([]);
	});

	it('draws the gallery on the east shore’s road, another loop’s, roofed as the ridden road’s, and nothing grows under it', () => {
		const colors = {
			stone: '#888',
			concrete: '#aaa',
			steel: '#999',
			dark: '#333',
			lamp: '#fff',
			band: '#ff0',
			earth: '#0f0',
			snow: '#fff',
		};
		const roofed = world.sides.flatMap((s, j) =>
			s.galleries.map((g) => ({ s, j, g })),
		);
		expect(roofed).toHaveLength(1);
		const [{ s, j, g }] = roofed;
		expect(g[1] - g[0]).toBeGreaterThan(250);
		const out = new Pieces();
		galleries(
			out,
			`side${j}`,
			s.route,
			world.groundAt,
			s.galleries,
			undefined,
			colors,
		);
		const pieces = [...out.geometries().keys()];
		expect(pieces.length).toBeGreaterThan(1);
		expect(pieces.every((k) => k.startsWith(`side${j}:`))).toBe(true);
		// A few hundred metres of roof: a small share beside the ridden road's granite.
		expect(out.triangles).toBeLessThan(10_000);
		const mid = at(s.route, (g[0] + g[1]) / 2);
		expect(world.roofedAt(mid.x, mid.z)).toBe(true);
	});
});

describe('a road with no design (a rider’s own)', () => {
	const climate = climateOf();
	const stoneFrom = stoneFromOf(climate);
	/** The hairpin pass fixture (900 m to 1,284 m), raised by `lift` metres. */
	const pass = (lift: number) =>
		routeOfRoad(
			toRoute(hairpinPass().map((p) => ({ ...p, ele: p.ele! + lift }))).road,
		);
	const edges = (route: Route, world: World) =>
		edgesOf(route, world.groundAt, [], stoneFrom);
	const markers = (route: Route, world: World) => {
		const seen = new Map<string, [number, number]>();
		for (let d = 0; d < route.length; d += 100) {
			const p = at(route, d);
			for (const t of world.tilesWithin(p.x, p.z, 300))
				seen.set(`${t[0]}:${t[1]}`, t);
		}
		return [...seen.values()]
			.flatMap(([ti, tj]) => world.tile(ti, tj).pieces)
			.filter((p) => p.kind === 'marker');
	};

	it('takes the generator’s climate: granite from the treeline', () => {
		expect(stoneFrom).toBe(climate.treeline);
		expect(climate.snowline).toBeGreaterThan(climate.treeline);
	});

	it(
		'gets granite above the treeline, steel rails under it where the land drops, and no markers under the snowline',
		() => {
			// 1,500 m to 1,884 m: the treeline crossed, the snowline not reached.
			const route = pass(climate.treeline - 1250);
			const world = generate(route);
			const runs = edges(route, world);
			const stone = runs.filter((r) => r.edge !== 'rail');
			const rails = runs.filter((r) => r.edge === 'rail');
			expect(stone.length).toBeGreaterThan(0);
			expect(rails.length).toBeGreaterThan(0);
			for (const r of stone)
				expect(
					at(route, r.from).ele,
					`${r.edge} at ${r.from} m`,
				).toBeGreaterThanOrEqual(stoneFrom - 1);
			for (const r of rails)
				expect(at(route, r.to).ele, `rail at ${r.from} m`).toBeLessThan(
					stoneFrom + 1,
				);
			expect(markers(route, world)).toEqual([]);
		},
		BUILD_MS,
	);

	it(
		'is marked with yellow and black poles above the snowline only',
		() => {
			// 2,250 m to 2,634 m: the snowline crossed on the way up.
			const route = pass(climate.snowline - 1000);
			const world = generate(route);
			const found = markers(route, world);
			expect(found.length).toBeGreaterThan(10);
			const { nearest } = roadIndex(route);
			for (const m of found) {
				const hit = nearest(m.x, m.z)!;
				expect(at(route, (hit.i + hit.t) * route.step).ele).toBeGreaterThan(
					climate.snowline - 5,
				);
			}
		},
		BUILD_MS,
	);

	it(
		'leaves a flat valley road bare',
		() => {
			const route = routeOfRoad(legsRoad([6000, 0]));
			const world = generate(route);
			expect(edges(route, world)).toEqual([]);
			expect(markers(route, world)).toEqual([]);
		},
		BUILD_MS,
	);
});
