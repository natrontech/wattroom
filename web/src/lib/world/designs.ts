/**
 * WattRoom's map (designed.ts): one made-up land, its roads and what lies
 * round them drawn on it together, and the loops a rider picks through it.
 * A lake between mountains, the river that leaves it through a gorge, a
 * pass over the massif east of both. Named after Swiss places a rider knows
 * and shaped like them from memory, never traced: no coordinate here is a
 * place's, and each name is changed.
 *
 * Metres east and north of the map's own origin; heights above sea. Every
 * loop is built of the same stretches of road between the same two nodes,
 * so two loops that share a stretch share it to the metre.
 */
import type { Designed, Feature, Spot } from './designed';
import { prng } from './rand';
import type { Corner } from './synthetic';

/**
 * A stretch of road with its long legs wound: no road runs a kilometre dead
 * straight. Each leg gets a point every `every` metres, set off to one side
 * and the other by turns, up to `amp(leg)` metres, and its height rolled by
 * up to `roll`: 0 keeps a leg as drawn, a bridge's or a hairpin's.
 */
function wind(
	corners: Corner[],
	seed: number,
	amp: (leg: number, a: Corner, b: Corner) => number,
	every = 270,
	roll = 0,
): Corner[] {
	const rand = prng(seed);
	return corners.flatMap((a, i) => {
		if (i === corners.length - 1) return [a];
		const b = corners[i + 1];
		const len = Math.hypot(b.x - a.x, b.y - a.y);
		const most = amp(i, a, b);
		const count = Math.round(len / every) - 1;
		if (most <= 0 || count < 1) return [a];
		let side = rand() < 0.5 ? 1 : -1;
		const out = [a];
		for (let k = 1; k <= count; k++) {
			const t = k / (count + 1);
			const off = side * most * (0.5 + 0.5 * rand());
			side = -side;
			out.push({
				x: a.x + (b.x - a.x) * t - ((b.y - a.y) / len) * off,
				y: a.y + (b.y - a.y) * t + ((b.x - a.x) / len) * off,
				ele: a.ele + (b.ele - a.ele) * t + roll * (2 * rand() - 1),
				r: 220,
			});
		}
		return out;
	});
}

/** The two nodes every loop is built between: the village south of the lake, and the head of the lake. */
// A loop turns at a node as a rider turns at a junction, tight round the corner: every loop's road passes within a couple of metres of the node, so the roads meet there.
const HUB: Corner = { x: 200, y: 300, ele: 1446, r: 9 };
const HEAD: Corner = { x: 150, y: 4250, ele: 1441, r: 10 };

/** A stretch between two nodes, wound, without the nodes themselves. */
const stretch = (
	from: Corner,
	drawn: Corner[],
	to: Corner,
	...how: [
		seed: number,
		amp: (leg: number, a: Corner, b: Corner) => number,
		every?: number,
		roll?: number,
	]
): Corner[] => wind([from, ...drawn, to], ...how).slice(1, -1);

/**
 * The east shore, hub to the head of the lake: 8 m over the water under the
 * massif's cliffs, up over a headland through a gallery, and across an
 * inlet on a bridge.
 */
const SHORE_DRAWN: Corner[] = [
	{ x: 480, y: 800, ele: 1444, r: 80 },
	{ x: 640, y: 1500, ele: 1442, r: 150 },
	{ x: 560, y: 2300, ele: 1470, r: 150 },
	{ x: 700, y: 3000, ele: 1443, r: 150 },
	{ x: 520, y: 3700, ele: 1442, r: 120 },
];
// Its bridge's leg stays straight.
const SHORE = stretch(HUB, SHORE_DRAWN, HEAD, 4340, (leg) =>
	leg === 4 ? 0 : 16,
);

/**
 * The west terrace, the head of the lake back to the hub: up and down from
 * one spur to the next, as high over the water as a bank of 1.5:1 lets a
 * road stand.
 */
const TERRACE = stretch(
	HEAD,
	[
		{ x: -450, y: 4050, ele: 1452, r: 80 },
		{ x: -1150, y: 3500, ele: 1500, r: 80 },
		{ x: -1000, y: 2700, ele: 1525, r: 90 },
		{ x: -1500, y: 2100, ele: 1580, r: 60 },
		{ x: -900, y: 1500, ele: 1548, r: 80 },
		{ x: -1400, y: 850, ele: 1560, r: 70 },
		{ x: -750, y: 350, ele: 1497, r: 60 },
	],
	HUB,
	4341,
	() => 26,
);

/**
 * The gorge: out over a spur in the river's bend, across the river on a
 * high bridge, round the moor on the plateau and back over the river into
 * the village.
 */
const GORGE = stretch(
	HUB,
	[
		// The spur: 1.6 km up from the village, the last 900 m at 9 %, and off it on a viaduct 130 m over the river.
		{ x: 300, y: -350, ele: 1472, r: 60 },
		{ x: 100, y: -1250, ele: 1552, r: 60 },
		{ x: 1250, y: -1450, ele: 1490, r: 80 },
		{ x: 1150, y: -2150, ele: 1450, r: 80 },
		{ x: 300, y: -2500, ele: 1470, r: 90 },
		{ x: -400, y: -2950, ele: 1445, r: 100 },
		{ x: -1500, y: -3100, ele: 1462, r: 100 },
		{ x: -2700, y: -2300, ele: 1448, r: 100 },
		{ x: -2600, y: -1300, ele: 1480, r: 80 },
		{ x: -1800, y: -1000, ele: 1455, r: 70 },
		{ x: -1100, y: -800, ele: 1450, r: 80 },
	],
	HUB,
	4404,
	// The two legs that cross the river stay straight: a bridge has no bend in it.
	(leg) => (leg === 2 || leg === 11 ? 0 : 28),
	270,
	3,
);

const HAIRPIN_R = 12;

/**
 * Col de Berne, hub to the head of the lake the long way: up the dry valley,
 * 21 hairpins up the massif's south face, out of the forest into the snow
 * and through a notch at 2,306 m between two peaks, eleven legs down the
 * north side and out by the tarn on its moor.
 * The legs are 430 m at 8 % on a face of 30 %, so each runs 15.5° off the
 * contour and the hillside between them is a hillside.
 */
function colDeBerne(): Corner[] {
	const LEG = 430;
	const off = Math.asin(0.08 / 0.3);
	const east = LEG * Math.cos(off);
	const north = LEG * Math.sin(off);
	const legs: Corner[] = [];
	for (let k = 0; k <= 22; k++)
		legs.push({
			x: k % 2 ? 3400 - east : 3400,
			y: -1200 + north * k,
			ele: 1530 + 0.08 * LEG * k,
			r: k === 0 ? 60 : k === 22 ? 40 : HAIRPIN_R,
		});
	const down: Corner[] = [];
	for (let k = 0; k <= 10; k++)
		down.push({
			x: k % 2 ? 2828 : 3500,
			y: 2200 + 196 * k,
			ele: 2260 - 49 * k,
			r: k === 0 ? 100 : k === 10 ? 60 : 14,
		});
	return stretch(
		HUB,
		[
			{ x: 1250, y: -350, ele: 1462, r: 120 },
			{ x: 2000, y: -1100, ele: 1485, r: 120 },
			{ x: 2700, y: -1700, ele: 1505, r: 100 },
			{ x: 3500, y: -1750, ele: 1522, r: 80 },
			...legs,
			{ x: 3300, y: 1650, ele: 2310, r: 60 },
			...down,
			// The north valley, down past the tarn to the lake.
			{ x: 2200, y: 4900, ele: 1690, r: 100 },
			{ x: 1400, y: 4700, ele: 1622, r: 100 },
			{ x: 800, y: 5000, ele: 1566, r: 80 },
			{ x: 300, y: 4900, ele: 1522, r: 60 },
			{ x: 550, y: 4500, ele: 1480, r: 40 },
		],
		HEAD,
		2101,
		// A leg between two hairpins bows a little; the valleys' roads wind.
		(_, a, b) =>
			a.r <= 14 || b.r <= 14 ? 10 : a.r <= 60 || b.r <= 60 ? 0 : 30,
		215,
	);
}
const COL = colDeBerne();

const peak = (
	at: Spot,
	rise: number,
	spread: number,
	clear?: readonly [number, number],
): Feature => ({ kind: 'peak', at, rise, spread, ...(clear && { clear }) });

/** Spots `off` metres left of the way from `a` to `b`, at each share `ts` of it: a shore beside a road. */
const beside = (a: Corner, b: Corner, off: number, ts: number[]): Spot[] => {
	const len = Math.hypot(b.x - a.x, b.y - a.y);
	const lx = -(b.y - a.y) / len;
	const ly = (b.x - a.x) / len;
	return ts.map((t) => [
		a.x + (b.x - a.x) * t + lx * off,
		a.y + (b.y - a.y) * t + ly * off,
	]);
};
/** The east shore lies this far from the road's centre: a strip of bank, and the water. */
const SHORE_M = 62;
const E = SHORE_DRAWN;

const LAND: Feature[] = [
	// The lake, 1,434 m: its east shore beside the road, an inlet under the road's bridge.
	{
		kind: 'lake',
		level: 1434,
		deep: 40,
		basin: { slope: 0.5, reach: 450 },
		shore: [
			...beside(E[0], E[1], SHORE_M, [0.3, 0.7]),
			...beside(E[1], E[2], SHORE_M, [0.1, 0.5, 0.9]),
			...beside(E[2], E[3], SHORE_M, [0.2, 0.6, 1]),
			...beside(E[3], E[4], SHORE_M, [0.33]),
			[1000, 3290],
			[1000, 3400],
			...beside(E[3], E[4], SHORE_M, [0.67, 0.95]),
			...beside(E[4], HEAD, SHORE_M + 30, [0.5]),
			[0, 3950],
			[-350, 3800],
			[-520, 3200],
			[-480, 2400],
			[-560, 1600],
			[-420, 1000],
			[-150, 760],
			[170, 740],
		],
	},
	// The river that leaves it, 34 m lower: a gorge round the spur's peninsula, and off south.
	{
		kind: 'river',
		course: [
			[-300, 150],
			[-300, -200],
			[-650, -900],
			[-300, -1600],
			[450, -1700],
			[850, -1100],
			[1500, -900],
			[1700, -1500],
			[1500, -2500],
			[1700, -3600],
			[1600, -4600],
		],
		width: 70,
		level: 1400,
		// Steep enough to be a gorge, gentle enough to be wooded: rock starts at 0.85.
		gorge: { bank: 15, slope: 0.6 },
	},
	// The lake's outlet, falling to the river under the terrace road.
	{
		kind: 'stream',
		course: [
			[-110, 730],
			[-200, 450],
			[-290, 170],
			[-300, 60],
		],
		width: 12,
	},

	// The massif. The two peaks of the notch, their feet cut by the road's own cuttings.
	peak([2450, 1800], 560, 420, [50, 320]),
	peak([4250, 1850], 640, 460, [50, 320]),
	// Its ridge: west, the wall over the lake's east shore; and east.
	peak([1500, 2100], 620, 620, [60, 420]),
	peak([1700, 600], 480, 600, [60, 420]),
	peak([5800, 2000], 800, 1000),
	peak([7200, 500], 500, 900),
	// Crags beside the hairpins, west and east of the stack by turns, steep enough to stand as rock.
	...[0, 1, 2, 3, 4, 5, 6].flatMap((k): Feature[] => [
		peak([2830, -1080 + 345 * k], 70 + 12 * k, 55, [20, 80]),
		peak([3555, -910 + 345 * k], 80 + 12 * k, 60, [20, 80]),
	]),
	// And over the north side's legs.
	peak([2660, 2600], 150, 90, [25, 110]),
	peak([3680, 2790], 170, 100, [25, 110]),
	peak([2650, 3380], 150, 90, [25, 110]),
	peak([3690, 3960], 150, 90, [25, 110]),
	// Cliffs over the east shore.
	peak([1080, 1300], 90, 70, [30, 110]),
	peak([980, 2350], 110, 80, [30, 110]),
	peak([1130, 2800], 100, 75, [30, 110]),
	// The west side's mountains, behind the terrace, and the head of the lake.
	peak([-2700, 2300], 900, 1000),
	peak([-2400, 4400], 500, 800),
	peak([-700, 5900], 500, 700),
	// The hills the river runs off between, and a knoll the gorge road bends round.
	peak([-3600, -500], 220, 900),
	peak([-1800, -4300], 200, 900),
	peak([900, -3900], 180, 800),
	peak([-1700, -1900], 70, 220, [40, 160]),

	// Streams. Off the notch's west peak, down the crags beside the hairpins, across the valley road and into the river.
	{
		kind: 'stream',
		course: [
			[2850, 1400],
			[2900, 800],
			[2870, 100],
			[2900, -600],
			[2930, -1200],
			[3050, -1650],
			[2700, -2300],
			[2200, -2800],
			[1650, -3000],
			[1450, -3050],
		],
	},
	// Off both of the lake's walls, white where they are steep, under the road and into the lake.
	{
		kind: 'stream',
		course: [
			[2000, 3300],
			[1500, 3360],
			[1050, 3345],
			[900, 3345],
		],
	},
	{
		kind: 'stream',
		course: [
			[1900, 1450],
			[1400, 1650],
			[1000, 1720],
			[700, 1750],
			[400, 1750],
		],
	},
	{
		kind: 'stream',
		course: [
			[-2400, 2950],
			[-1800, 2800],
			[-1300, 2500],
			[-800, 2450],
			[-400, 2450],
		],
	},
	// Off the hills into the river: under the gorge road.
	{
		kind: 'stream',
		course: [
			[-3200, -300],
			[-2300, -600],
			[-1500, -700],
			[-900, -600],
			[-560, -760],
		],
	},
	{
		kind: 'stream',
		course: [
			[900, -3400],
			[700, -2800],
			[300, -2100],
			[150, -1750],
			[120, -1600],
		],
	},

	// The tarn on the north side's moor, the road round it, and the stream that feeds it.
	{
		kind: 'lake',
		level: 1578,
		deep: 12,
		basin: { slope: 0.2, reach: 320 },
		shore: [
			[1300, 5180],
			[1210, 5320],
			[1040, 5330],
			[960, 5190],
			[1030, 5050],
			[1200, 5050],
		],
	},
	{
		kind: 'stream',
		course: [
			[1300, 6500],
			[1050, 5900],
			[1150, 5500],
			[1120, 5270],
		],
	},
	{ kind: 'land', cover: 'moor', at: [1150, 5100], radius: 750 },
	// The moor on the plateau west of the gorge, and reeds at the head of the lake.
	{ kind: 'land', cover: 'moor', at: [-2300, -2100], radius: 800 },
	{ kind: 'land', cover: 'moor', at: [-150, 4250], radius: 380 },
	// The valley under the climb, in the massif's rain shadow.
	{ kind: 'land', cover: 'dry', at: [2300, -1500], radius: 1000 },
];

/** What every loop on the map shares: its land, its weather and its names. */
const MAP = {
	features: LAND,
	// Snow from 2,050 m, eight hairpins under the col, and the forest up into it: the last trees stand white.
	climate: { snowline: 2050, treeline: 2230 },
	names: {
		passes: [
			{ name: 'Col de Berne', at: [3300, 1650] },
			{ name: 'Axenegg', at: [-1500, 2100] },
			{ name: 'Seelisgrat', at: [-1400, 850] },
			{ name: 'Morschachli', at: [560, 2300] },
			{ name: 'Bantigeregg', at: [100, -1250] },
			{ name: 'Längenhubel', at: [-2600, -1300] },
		],
		villages: [
			'Flüetritt',
			'Sisiwatt',
			'Bauenkurbel',
			'Brunnach',
			'Aarwatt',
			'Muribrügg',
			'Wohlensprint',
			'Kirchtritt',
			'Praz-Pédale',
			'Les Rampes',
			'Combe-Kurbel',
			'Vex-le-Watt',
			'Seewatt',
			'Rütitritt',
			'Isenkette',
			'Urnried',
		],
	},
	galleries: [
		// Under the east shore's cliffs, the lake seen between its pillars; and an avalanche gallery high on the climb.
		[
			[630, 1650],
			[585, 2100],
		],
		[
			[3340, 882],
			[3080, 955],
		],
	],
	// Roads no loop rides, so the land is not one road wide: each leaves a loop's road at a junction or crosses it.
	spurs: [
		// South out of the gorge loop, down the river's valley.
		[
			{ x: 300, y: -2500, ele: 1470, r: 0 },
			{ x: 650, y: -3000, ele: 1452, r: 0 },
			{ x: 500, y: -3700, ele: 1440, r: 0 },
			{ x: 800, y: -4400, ele: 1428, r: 0 },
		],
		// Across the plateau's moor, over the gorge loop twice.
		[
			{ x: -3700, y: -1300, ele: 1492, r: 0 },
			{ x: -2660, y: -1700, ele: 1467, r: 0 },
			{ x: -2000, y: -2300, ele: 1458, r: 0 },
			{ x: -1150, y: -3060, ele: 1456, r: 0 },
			{ x: -900, y: -3900, ele: 1470, r: 0 },
		],
		// Off the valley road under the climb, out through the dry valley.
		[
			{ x: 2000, y: -1100, ele: 1485, r: 0 },
			{ x: 2500, y: -2100, ele: 1478, r: 0 },
			{ x: 3300, y: -2700, ele: 1492, r: 0 },
			{ x: 4200, y: -2600, ele: 1510, r: 0 },
		],
		// North from the head of the lake, up the side valley.
		[
			{ x: 150, y: 4250, ele: 1441, r: 0 },
			{ x: -150, y: 4800, ele: 1462, r: 0 },
			{ x: -100, y: 5400, ele: 1500, r: 0 },
		],
		// The village's lane down to the foot of the lake.
		[
			{ x: -250, y: 620, ele: 1440, r: 0 },
			{ x: -30, y: 480, ele: 1443, r: 0 },
			{ x: 200, y: 300, ele: 1446, r: 0 },
		],
		// A farm lane north off the valley road, square to it: a road leaving another at a shallow angle runs beside it for a kilometre.
		[
			{ x: 1250, y: -350, ele: 1462, r: 0 },
			{ x: 1500, y: 250, ele: 1480, r: 0 },
			{ x: 2000, y: 600, ele: 1515, r: 0 },
		],
	],
} satisfies Pick<
	Designed,
	'features' | 'climate' | 'names' | 'galleries' | 'spurs'
>;

const loop = (
	id: string,
	lengthM: number,
	seed: number,
	corners: Corner[],
	others: string[],
): Designed => ({
	id,
	lengthM,
	shape: { corners, seed, drawn: true },
	others,
	...MAP,
});

/**
 * The Valley loop, a land of its own below the map's: rolling farmland at
 * about 520–630 m, so farms with their cows, milk cans and cattle signs;
 * a river through the middle of it, bridged twice; a pond by the road; and
 * two short ramps steep enough for the steep-road sign. About 16 km.
 */
const VALLEY_DRAWN: Corner[] = [
	{ x: 0, y: 0, ele: 520, r: 200 },
	{ x: 2500, y: 0, ele: 522, r: 150 },
	{ x: 2800, y: 0, ele: 549, r: 60 },
	{ x: 4500, y: 800, ele: 560, r: 250 },
	{ x: 5000, y: 2500, ele: 540, r: 200 },
	{ x: 4200, y: 3600, ele: 600, r: 60 },
	{ x: 3900, y: 3800, ele: 630, r: 40 },
	{ x: 2500, y: 4300, ele: 600, r: 250 },
	{ x: 800, y: 3800, ele: 560, r: 250 },
	{ x: -600, y: 2600, ele: 535, r: 300 },
	{ x: -500, y: 1000, ele: 522, r: 250 },
];
// Its two bridges' legs stay straight; the rest winds through the fields.
const VALLEY = wind(
	[...VALLEY_DRAWN, VALLEY_DRAWN[0]],
	4248,
	(leg) => (leg === 3 || leg === 9 ? 0 : 34),
	270,
	2,
).slice(0, -1);

const VALLEY_LAND: Feature[] = [
	// The river, in a shallow wooded valley of its own: under the road on its way in and on its way out.
	{
		kind: 'river',
		course: [
			[-2600, 2400],
			[-1500, 2200],
			[-560, 2050],
			[800, 2000],
			[2200, 2600],
			[3600, 1900],
			[4850, 1800],
			[5800, 1500],
			[7000, 1600],
		],
		width: 40,
		level: 512,
		gorge: { bank: 25, slope: 0.3 },
	},
	// The pond by the first straight, and the stream out of it.
	{
		kind: 'lake',
		level: 515,
		deep: 6,
		basin: { slope: 0.12, reach: 260 },
		shore: [
			[1180, 190],
			[1330, 150],
			[1470, 230],
			[1440, 380],
			[1280, 430],
			[1150, 330],
		],
	},
	{
		kind: 'stream',
		course: [
			[1350, 440],
			[1500, 900],
			[1300, 1500],
			[1500, 2100],
			[1550, 2300],
		],
	},
	// Streams off the hills north and south into the river, under the road.
	{
		kind: 'stream',
		course: [
			[2700, 5600],
			[2600, 4700],
			[2300, 3700],
			[2250, 2900],
			[2200, 2600],
		],
	},
	{
		kind: 'stream',
		course: [
			[3900, -1200],
			[3700, -300],
			[3500, 700],
			[3550, 1500],
			[3600, 1900],
		],
	},
	// Low wooded hills round it, and a knoll in the middle the loop goes round.
	peak([2400, 6000], 160, 900),
	peak([-2400, 500], 140, 900),
	peak([6800, 3600], 150, 900),
	peak([3300, -2200], 120, 800),
	peak([1900, 1300], 45, 260, [40, 200]),
	{ kind: 'land', cover: 'moor', at: [600, 2350], radius: 420 },
];

/** The loops, each from the hub and back: by the time they take, about 30, 40, 60 and 90 minutes. */
export const DESIGNS: readonly Designed[] = [
	loop(
		'urnsee',
		10691.12,
		4340,
		[HUB, ...SHORE, HEAD, ...TERRACE],
		['aare', 'berne'],
	),
	loop('aare', 11986.98, 4404, [HUB, ...GORGE], ['urnsee', 'berne']),
	loop(
		'lac',
		22692.33,
		4406,
		[HUB, ...SHORE, HEAD, ...TERRACE, HUB, ...GORGE],
		['berne'],
	),
	loop(
		'berne',
		30811.49,
		2101,
		[HUB, ...COL, HEAD, ...TERRACE],
		['urnsee', 'aare'],
	),
	{
		id: 'valley',
		lengthM: 16036.55,
		shape: { corners: VALLEY, seed: 4248, drawn: true },
		features: VALLEY_LAND,
	},
];
