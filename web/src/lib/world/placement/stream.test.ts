// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { toRoute } from '$lib/road/route';
import { STYLES } from '../../../routes/(app)/dev/world/styles';
import { syntheticPoints } from '../synthetic';
import { generate, type World } from '../world';
import { bannerRefusals, inWattBand } from './safety';
import {
	apart,
	clock,
	crowded,
	flicker,
	lulls,
	realFirst,
	streamHash,
	zoned,
	type Passing,
	type Profile,
} from './stream';

/** Three flat kilometres, a height every 10 m. */
const flat: Profile = {
	step: 10,
	heights: Array.from({ length: 301 }, () => 500),
};
/** The same three kilometres climbing at 8 %. */
const climb: Profile = {
	step: 10,
	heights: Array.from({ length: 301 }, (_, i) => 500 + i * 0.8),
};

let n = 0;
const at = (along: number, o: Partial<Passing> = {}): Passing => ({
	id: `p${n++}`,
	kind: 'bench',
	size: 'small',
	along,
	side: 1,
	offset: 12,
	source: 'generated',
	at: [along, 12],
	...o,
});

describe('O9 rhythm (#3221)', () => {
	it('keeps the same small thing 45 s apart at the faster direction’s pace', () => {
		expect(apart([at(100), at(200)], flat)).toHaveLength(1);
		expect(apart([at(100), at(1000)], flat)).toEqual([]);
		// A different variant is a different thing.
		expect(apart([at(100), at(200, { variant: 'b' })], flat)).toEqual([]);
	});

	it('times a climb at its descent: the same spacing is tighter there', () => {
		const t = clock(climb);
		const d =
			45 *
			(t.fast(1000) - t.fast(0) > 0 ? 1000 / (t.fast(1000) - t.fast(0)) : 0);
		// Just past 45 s riding up is under 45 s riding down, which is the faster.
		const upOnly = 45 * (1000 / (t.forward(1000) - t.forward(0)));
		expect(d).toBeGreaterThan(upOnly);
		expect(apart([at(100), at(100 + upOnly * 1.2)], climb)).toHaveLength(1);
	});

	it('allows two identical in 150 m, not three — unless they are a declared cluster of three variants', () => {
		expect(crowded([at(0), at(60)])).toEqual([]);
		expect(crowded([at(0), at(60), at(120)])).toHaveLength(1);
		// Three of one variant within 150 m: crowded on their own, fine as an orchard of three variants.
		const trees = ['a', 'b', 'a', 'c', 'a'];
		const loose = trees.map((variant, i) =>
			at(i * 30, { variant, kind: 'tree' }),
		);
		expect(crowded(loose)).toHaveLength(1);
		const orchard = loose.map((p) => ({ ...p, cluster: 'orchard' }));
		expect(crowded(orchard)).toEqual([]);
	});

	it('never leaves 90 s with nothing new within 80 m, riding either way', () => {
		const every500 = [0, 500, 1000, 1500, 2000, 2500, 3000].map((a) => at(a));
		expect(lulls(every500, flat)).toEqual([]);
		// The same marks on a climb: riding up, 500 m takes the reference rider longer than 90 s.
		expect(lulls(every500, climb).length).toBeGreaterThan(0);
		const hole = every500.filter((p) => p.along !== 1000 && p.along !== 1500);
		expect(lulls(hole, flat)).toHaveLength(1);
		// Farther out than 80 m is not what a rider meets.
		expect(lulls([...hole, at(1250, { offset: 120 })], flat)).toHaveLength(1);
		expect(lulls([...hole, at(1250, { offset: 60 })], flat)).toEqual([]);
	});

	it('thins real marks to one per kind per 150 m per side, before any generated one', () => {
		const osm = { source: 'osm' as const, kind: 'wayside' };
		expect(realFirst([at(0, osm), at(100, osm)])).toHaveLength(1);
		expect(realFirst([at(0, osm), at(100, { ...osm, side: -1 })])).toEqual([]);
		expect(realFirst([at(0, osm), at(90, { kind: 'wayside' })])).toHaveLength(
			1,
		);
		expect(realFirst([at(0, osm), at(400, { kind: 'wayside' })])).toEqual([]);
	});
});

describe('O11 determinism (#3221)', () => {
	it('hashes a place the same whatever order its things came in, and moves with a centimetre', () => {
		const things = [
			at(10),
			at(20, { kind: 'fountain' }),
			at(30, { variant: 'b' }),
		];
		expect(streamHash([...things].reverse())).toBe(streamHash(things));
		const moved = things.map((p, i) =>
			i === 1 ? { ...p, at: [p.at[0] + 0.01, p.at[1]] as const } : p,
		);
		expect(streamHash(moved)).not.toBe(streamHash(things));
	});
});

describe('O13 what may not stand there (#3221)', () => {
	it('puts nothing from the map inside a privacy zone', () => {
		const zone = [
			[0, 0],
			[50, 0],
			[50, 50],
			[0, 50],
		] as const;
		expect(
			zoned([at(20, { source: 'osm', at: [20, 20] })], [zone]),
		).toHaveLength(1);
		expect(zoned([at(20, { at: [20, 20] })], [zone])).toEqual([]);
		expect(zoned([at(90, { source: 'osm', at: [90, 20] })], [zone])).toEqual(
			[],
		);
	});

	it('keeps a row of posts under 3 Hz at 80 km/h', () => {
		const row = (every: number) =>
			Array.from({ length: 5 }, (_, i) =>
				at(i * every, { kind: 'fence post', row: true }),
			);
		expect(flicker(row(2.5))).toHaveLength(4);
		expect(flicker(row(8))).toEqual([]);
	});

	it('refuses real brands, events, the Swiss cross and cantonal arms on a banner, as the wardrobe does', () => {
		expect(bannerRefusals('Tour de France stage 12')).toEqual([
			'Tour de France',
		]);
		expect(bannerRefusals('Zwift ride')).toEqual(['Zwift']);
		expect(bannerRefusals('Swiss cross')).toEqual(['cross']);
		expect(bannerRefusals('Kantonswappen Uri')).toEqual([]);
		expect(bannerRefusals('Wappen of Uri')).toEqual(['wappen']);
		// A word inside a name is not the word.
		expect(bannerRefusals('Kreuzberg · Giromont')).toEqual([]);
	});

	it('knows the watt band from every dark identity', () => {
		expect(inWattBand('#ff3d8b')).toBe(true); // Outrun's watt
		expect(inWattBand('#3a6ea5')).toBe(false); // a slate blue
		expect(inWattBand('#8f8f8f')).toBe(false); // grey: no chroma to read as data
	});
});

describe('the dev world against O13', () => {
	let w: World;
	beforeAll(() => {
		w = generate(toRoute(syntheticPoints()));
		void w.everything;
	}, 60_000);

	it('writes nothing refused on its signs and arches', () => {
		const words = [
			...w.signs.flatMap((s) => s.lines),
			...w.arches.map((a) => a.label),
			w.names.pass,
			w.names.peak,
		];
		expect(words.length).toBeGreaterThan(5);
		expect(
			words.flatMap((t) => bannerRefusals(t).map((r) => `${t}: ${r}`)),
		).toEqual([]);
	});

	/** Colours on the ride that sit in the watt band, and who takes them out. Live data — the trail, the zone rings — may. */
	const IN_BAND: Record<string, string> = {
		'props.hiking':
			'#3085 gives the ride its own look: the hiking sign’s yellow reads as a yellow identity’s watt',
		'props.flags.0':
			'#3085: a summit flag’s red reads as a red identity’s watt',
		'props.flags.2':
			'#3085: a summit flag’s red reads as a red identity’s watt',
		'props.flags.3':
			'#3085: a summit flag’s yellow reads as a yellow identity’s watt',
	};

	it('dresses the ride in no colour that reads as live data, or names who changes it', () => {
		const ride = STYLES.find((s) => s.id === 'bluehour')!;
		const found: string[] = [];
		const walk = (o: unknown, path: string): void => {
			if (typeof o === 'string') {
				if (/^#[0-9a-f]{6}$/i.test(o) && inWattBand(o)) found.push(path);
			} else if (o && typeof o === 'object')
				for (const [k, v] of Object.entries(o))
					walk(v, path ? `${path}.${k}` : k);
		};
		const { trail, zones, ...objects } = ride;
		void trail;
		void zones;
		walk(objects, '');
		expect(found.filter((p) => !IN_BAND[p])).toEqual([]);
		expect(
			Object.keys(IN_BAND).filter((p) => !found.includes(p)),
			'no longer in band: take it out of IN_BAND',
		).toEqual([]);
	});
});
