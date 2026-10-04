import { beforeAll, describe, expect, it } from 'vitest';
import { referenceSpeed } from '$lib/road/pace';
import { toRoute, type Route } from '$lib/road/route';
import { STYLES } from '../../routes/(app)/dev/world/styles';
import { backdrop, bearings } from './backdrop';
import { CHUNK_M } from './place/lattice';
import { rhythmOf } from './props/rhythm';
import { syntheticPoints } from './synthetic';
import { generate, type World } from './world';
import { BUILD_MS, longLoopPoints } from './world.test-helper';

/**
 * The route-wide work a ride does before its first frame (#3797) was made
 * cheaper, never different: the same route still yields the same world.
 * Each digest below was taken on main before that work and is held here
 * byte for byte — the set pieces' plan is spaced by the riding clock and
 * dressed around the villages, so a last bit that moved moves a bench.
 *
 * The two horizon digests are the exception: they were re-taken when the
 * ridges' rock and snow colours became a blend over a height band, so a peak
 * no longer draws a vertical seam where it crosses the line (#3835).
 */

/** FNV-1a over every number's float64 bytes, in order. */
function digest(values: Iterable<number>): string {
	const view = new DataView(new ArrayBuffer(8));
	let h = 0x811c9dc5;
	for (const v of values) {
		view.setFloat64(0, v);
		for (let i = 0; i < 8; i++) h = Math.imul(h ^ view.getUint8(i), 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

/** The same over a value's JSON, whose numbers round-trip exactly. */
const digestOf = (value: unknown) =>
	digest([...JSON.stringify(value)].map((c) => c.charCodeAt(0)));

/** What a ride's first frame settles: the tiles around its start, nearest first. */
function aroundStart(route: Route, world: World) {
	const tiles = world
		.tilesWithin(route.x[0], route.z[0], 1500)
		.map(([ti, tj]) => world.tile(ti, tj));
	return digestOf(
		tiles.map((t) => [t.props, t.pieces, t.signs, t.arches, t.placements]),
	);
}

function rhythmDigest(world: World) {
	const r = rhythmOf(world.roads[0]);
	const out: number[] = [r.length, r.total];
	for (let s = 0; s <= r.length; s += 37) out.push(r.up(s), r.fast(s));
	for (let t = 0; t <= r.total; t += 11) out.push(r.at(t));
	return digest(out);
}

function horizonDigest(route: Route, world: World) {
	const [minX, minZ, maxX, maxZ] = world.bounds;
	const g = backdrop(
		route,
		world.seed,
		Math.hypot(maxX - minX, maxZ - minZ) / 2,
		{ ...STYLES[0].backdrop, fog: STYLES[0].sky.horizon },
		true,
	);
	const b = bearings(route);
	return digest([
		b.hero,
		b.second,
		b.share,
		...g.getAttribute('position').array,
		...g.getAttribute('color').array,
	]);
}

describe('the reference pace', () => {
	it('answers every grade as it did', () => {
		const out: number[] = [];
		for (let g = -30; g <= 30; g += 0.0137) out.push(referenceSpeed(g));
		expect(digest(out)).toBe('b44a98a2');
	});
});

describe('a 29 km loop, its route-wide work', () => {
	let route: Route;
	let world: World;
	beforeAll(() => {
		route = toRoute(syntheticPoints());
		world = generate(route);
	}, BUILD_MS);

	it('reads the drawn ground where nothing has built it yet as where something has', () => {
		const out: number[] = [];
		for (let x = -3000; x <= 3000; x += 97)
			for (let z = -3000; z <= 3000; z += 89) out.push(world.heightAt(x, z));
		expect(digest(out)).toBe('6a821d83');
		const grids: number[] = [];
		for (let ci = -6; ci <= 6; ci += 3)
			for (let cj = -6; cj <= 6; cj += 3) {
				const g = world.grid(ci, cj);
				if (g) grids.push(...g.h, ...g.biome, ...g.shade, ...g.forest);
			}
		expect(digest(grids)).toBe('4ea1647b');
		expect(CHUNK_M).toBe(160);
	});

	it('names the same villages at the same metres', () => {
		expect(digestOf([world.villageNames, world.markers])).toBe('7fcecd1d');
	});

	it('keeps the same riding clock', () => {
		expect(rhythmDigest(world)).toBe('0926db69');
	});

	it('draws the same horizon', () => {
		expect(horizonDigest(route, world)).toBe('04a78ec4');
	});

	it('stands the same things around the start, and along the whole loop', () => {
		expect(aroundStart(route, world)).toBe('d718762a');
		const all = world.everything;
		expect(
			digestOf([all.props, all.pieces, all.signs, all.arches, all.placements]),
		).toBe('4d276fbb');
	});
});

describe('a 124 km loop, its route-wide work', () => {
	let route: Route;
	let world: World;
	beforeAll(() => {
		route = toRoute(longLoopPoints());
		world = generate(route);
	}, BUILD_MS);

	it('names the same villages, keeps the same clock and draws the same horizon', () => {
		expect(digestOf([world.villageNames, world.markers])).toBe('47bf6885');
		expect(rhythmDigest(world)).toBe('d1c51d12');
		expect(horizonDigest(route, world)).toBe('017a6789');
	});

	// Its start meets its end: the pieces planned before the finish are decided too.
	it('stands the same things around the start', () => {
		expect(aroundStart(route, world)).toBe('5b17ee81');
	});
});
