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
 * (numbers settled to 6 digits, #3849) — the set pieces' plan is spaced by the riding clock and
 * dressed around the villages, so a last bit that moved moves a bench. They
 * were retaken for #3832: a road's ends keep their grade now, so the
 * riding clock and what hangs on it moved; and for #3675, whose forest
 * frames the road.
 *
 * The two horizon digests are the exception: they were re-taken when a
 * westward heading stopped counting toward bins up to 80° away (#3829),
 * which moves the hero peak on a route ridden partly westward on purpose,
 * and when the ridges' rock and snow colours became a blend over a height
 * band, so a peak draws no vertical seam where it crosses the line (#3835),
 * and when the ranges came to be sized by the angle they stand at, so the
 * farthest stands low enough for the sky's peach to clear it (#3085).
 */

/**
 * A number to 6 significant digits. libm's pow and exp answer in the last bit
 * differently on arm64 and x64, so a digest over raw float64 bytes is red on
 * a Mac while green in CI (#3849); a world that really changed moves digits
 * far above the 6th.
 */
const settled = (v: number) => (Number.isFinite(v) ? +v.toPrecision(6) : v);

/** FNV-1a over every number's settled float64 bytes, in order. */
function digest(values: Iterable<number>): string {
	const view = new DataView(new ArrayBuffer(8));
	let h = 0x811c9dc5;
	for (const v of values) {
		view.setFloat64(0, settled(v));
		for (let i = 0; i < 8; i++) h = Math.imul(h ^ view.getUint8(i), 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

/** The same over a value's JSON, its numbers settled the same way. */
const digestOf = (value: unknown) =>
	digest(
		[
			...JSON.stringify(value, (_, v) =>
				typeof v === 'number' ? settled(v) : v,
			),
		].map((c) => c.charCodeAt(0)),
	);

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
	const { geometry: g } = backdrop(
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
		expect(digest(out)).toBe('9f7cccf2');
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
		expect(digest(out)).toBe('13000c6f');
		const grids: number[] = [];
		for (let ci = -6; ci <= 6; ci += 3)
			for (let cj = -6; cj <= 6; cj += 3) {
				const g = world.grid(ci, cj);
				if (g) grids.push(...g.h, ...g.biome, ...g.shade, ...g.forest);
			}
		expect(digest(grids)).toBe('445a41b4');
		expect(CHUNK_M).toBe(160);
	});

	it('names the same villages at the same metres', () => {
		expect(digestOf([world.villageNames, world.markers])).toBe('25faa618');
	});

	it('keeps the same riding clock', () => {
		expect(rhythmDigest(world)).toBe('22577077');
	});

	it('draws the same horizon', () => {
		expect(horizonDigest(route, world)).toBe('4802fb68');
	});

	it(
		'stands the same things around the start, and along the whole loop',
		() => {
			expect(aroundStart(route, world)).toBe('3480b172');
			const all = world.everything;
			expect(
				digestOf([
					all.props,
					all.pieces,
					all.signs,
					all.arches,
					all.placements,
				]),
			).toBe('6d2c813d');
		},
		BUILD_MS,
	);
});

describe('a 124 km loop, its route-wide work', () => {
	let route: Route;
	let world: World;
	beforeAll(() => {
		route = toRoute(longLoopPoints());
		world = generate(route);
	}, BUILD_MS);

	it('names the same villages, keeps the same clock and draws the same horizon', () => {
		expect(digestOf([world.villageNames, world.markers])).toBe('efe6aff7');
		expect(rhythmDigest(world)).toBe('602d4bc8');
		expect(horizonDigest(route, world)).toBe('b85d6eb8');
	});

	// Its start meets its end: the pieces planned before the finish are decided too.
	it('stands the same things around the start', () => {
		expect(aroundStart(route, world)).toBe('600388a8');
	});
});
