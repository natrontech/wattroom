import { describe, expect, it } from 'vitest';
import {
	at,
	camera,
	network,
	OWNER_SALT,
	routes,
	seam,
	type LatLon,
	type Route,
} from './network.test-helper';
import {
	groundGap,
	sameArch,
	sameHorizon,
	sameNames,
	straddling,
	unmatched,
	type BuiltWorld,
} from './shared';
import { buildToy, type Mutant } from './toy-world.test-helper';

/**
 * Same road, same world (#3226): on a synthetic network, worlds built from a
 * loop (A), its climb as its own file (B), B ridden down (C) and B
 * re-recorded with 3 m of GPS error (Bn) agree on their shared stretch, 300 m
 * clear of B's ends, around one camera. Each predicate is red on a world
 * keyed by the route in one of the ways the lab found; #3222 keeps the list.
 */

const net = network();
const R = routes();
const cam = camera();
const build = (r: Route, mutant?: Mutant): BuiltWorld =>
	buildToy(net, r, { camera: cam, mutant });
const PAIRS = [
	['A', 'B'],
	['B', 'C'],
	['B', 'Bn'],
] as const;

// Along the camera's switchback leg, the road and 50, 200 and 1,000 m either side of it.
const climb = net.roads[0].points;
const samples: LatLon[] = [110, 115, 120, 125].flatMap((i) =>
	[0, 50, -50, 200, -200, 1000, -1000].map((d) => at(climb[i], 0, d)),
);

type Check = (a: BuiltWorld, b: BuiltWorld) => boolean;
const PREDICATES: Record<string, Check> = {
	'the ground at the road and 50, 200 and 1,000 m off it': (a, b) =>
		groundGap(a, b, samples) < 0.005,
	'every object, by kind, within 1 cm': (a, b) =>
		unmatched(a.things, b.things) === 0,
	'every sign, with its words': (a, b) => unmatched(a.signs, b.signs) === 0,
	'the arch': sameArch,
	'the names': sameNames,
	'the horizon station': sameHorizon,
};

// Each predicate, and the route-keyed worlds it must catch.
const MUTANTS: [string, Mutant][] = [
	['the ground at the road and 50, 200 and 1,000 m off it', 'centroid'],
	['every object, by kind, within 1 cm', 'seed'],
	['every object, by kind, within 1 cm', 'bbox'],
	['every sign, with its words', 'riding-time'],
	['every sign, with its words', 'hairpins-from-start'],
	['the arch', 'riding-time'],
	['the names', 'name-stream'],
	['the horizon station', 'centroid'],
];

describe('same road, same world on the shared stretch (#3226)', () => {
	const worlds = Object.fromEntries(
		Object.entries(R).map(([k, r]) => [k, build(r)]),
	) as Record<keyof typeof R, BuiltWorld>;

	it('builds a stretch with something to compare', () => {
		const w = worlds.B;
		expect(w.things.length).toBeGreaterThan(100);
		expect(w.signs.filter((s) => s.kind === 'hairpin').length).toBeGreaterThan(
			0,
		);
		expect(w.signs.filter((s) => s.kind === 'marker').length).toBeGreaterThan(
			0,
		);
		expect(w.names).toContain('Toyjoch');
		expect(w.names.length).toBeGreaterThan(1);
	});

	for (const [name, check] of Object.entries(PREDICATES))
		it(`agrees on ${name}, whichever route reached it`, () => {
			for (const [a, b] of PAIRS)
				expect(check(worlds[a], worlds[b]), `${a} vs ${b}`).toBe(true);
		});

	for (const [name, mutant] of MUTANTS)
		it(`catches a world keyed by the route (${mutant}) on ${name}`, () => {
			const keyedByRoute = Object.fromEntries(
				Object.entries(R).map(([k, r]) => [k, build(r, mutant)]),
			) as Record<keyof typeof R, BuiltWorld>;
			expect(
				PAIRS.some(
					([a, b]) => !PREDICATES[name](keyedByRoute[a], keyedByRoute[b]),
				),
			).toBe(true);
		});
});

describe('across a UTM zone line', () => {
	const s = seam();
	const world = (r: Route, mutant?: Mutant) =>
		buildToy(s.net, r, { camera: s.camera, mutant });

	it('keys no cell across the line, and both directions agree on both sides', () => {
		const [e, w] = [world(s.east), world(s.west)];
		expect(new Set(e.things.map((t) => t.frame))).toEqual(
			new Set(['UTM32N', 'UTM33N']),
		);
		expect(straddling(e.things) + straddling(w.things)).toBe(0);
		expect(unmatched(e.things, w.things)).toBe(0);
	});

	it('catches tile-local frames outside LV95', () => {
		const [e, w] = [world(s.east, 'tile-local'), world(s.west, 'tile-local')];
		expect(straddling(e.things)).toBeGreaterThan(0);
		expect(unmatched(e.things, w.things)).toBeGreaterThan(0);
	});
});

describe('a private region', () => {
	const B = R.B;
	// The same climb, 3 km east: the owner's own route somewhere else.
	const moved: Route = {
		name: B.name,
		points: B.points.map((p) => at(p, 3000, 0)),
	};
	const around = (r: Route, owner?: typeof OWNER_SALT, mutant?: Mutant) =>
		buildToy(net, r, { camera: r.points[0], radius: 150, owner, mutant });
	const own = (w: BuiltWorld) =>
		w.things.filter((t) => t.frame.startsWith('region'));

	it('replaces the public world inside it with the owner’s own', () => {
		const owner = around(B, OWNER_SALT);
		expect(own(owner).length).toBeGreaterThan(10);
		// Everything outside the region is the public world's; everything inside is gone from it.
		expect(unmatched(owner.things, around(B).things)).toBeGreaterThan(40);
	});

	it('is the same wherever the owner’s road goes: its own cells, never the world’s', () => {
		expect(
			unmatched(own(around(B, OWNER_SALT)), own(around(moved, OWNER_SALT))),
		).toBe(0);
	});

	it('catches a region keyed with the world secret', () => {
		const owner = around(B, OWNER_SALT, 'region-world-secret');
		expect(unmatched(owner.things, around(B).things)).toBe(0);
	});

	it('catches a region keyed in world cells', () => {
		const m = 'region-world-cells';
		expect(
			unmatched(
				own(around(B, OWNER_SALT, m)),
				own(around(moved, OWNER_SALT, m)),
			),
		).toBeGreaterThan(0);
	});
});
