/**
 * WattRoom's designed roads (designed.ts): each a made-up map, the road's
 * corners and the land round them drawn on it together. Named after Swiss
 * places a rider knows and shaped like them from memory, never traced: no
 * coordinate here is a place's, and each name is changed.
 *
 * Metres east and north of the map's own origin; heights above sea.
 */
import type { Designed, Feature, Spot } from './designed';
import { prng } from './rand';
import type { Corner } from './synthetic';

/**
 * A road's corners with its long legs wound: no road runs a kilometre dead
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
		const b = corners[(i + 1) % corners.length];
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

const HAIRPIN_R = 12;

/**
 * Col de Berne: 21 hairpins up a south face, out of the forest at 1,850 m
 * and on to a notch at 2,306 m between two snow peaks, then a long way down
 * the north side and round the massif's west end.
 * The legs are 430 m at 8 % on a face of 30 %, so each runs 15.5° off the
 * contour and the hillside between them is a hillside (the stacked 21
 * hairpins of the tests stand 50 m over each other).
 */
function colDeBerne(): Corner[] {
	const LEG = 430;
	const off = Math.asin(0.08 / 0.3);
	const east = LEG * Math.cos(off);
	const north = LEG * Math.sin(off);
	const legs: Corner[] = [];
	for (let k = 0; k <= 22; k++)
		legs.push({
			x: k % 2 ? 800 - east : 800,
			y: 1300 + north * k,
			ele: 1530 + 0.08 * LEG * k,
			r: k === 0 ? 60 : k === 22 ? 40 : HAIRPIN_R,
		});
	const drawn: Corner[] = [
		// The south valley, dry and rolling, east to the foot of the climb.
		{ x: -3000, y: -200, ele: 1360, r: 200 },
		{ x: -2300, y: 200, ele: 1392, r: 120 },
		{ x: -1500, y: -200, ele: 1368, r: 100 },
		{ x: -600, y: 100, ele: 1398, r: 120 },
		{ x: 600, y: 300, ele: 1420, r: 150 },
		{ x: 1100, y: 900, ele: 1485, r: 120 },
		...legs,
		// The col, and five long legs down the north face.
		{ x: 700, y: 4150, ele: 2310, r: 60 },
		{ x: 900, y: 4700, ele: 2260, r: 100 },
		{ x: 228, y: 4896, ele: 2211, r: 14 },
		{ x: 900, y: 5092, ele: 2162, r: 14 },
		{ x: 228, y: 5288, ele: 2113, r: 14 },
		{ x: 900, y: 5484, ele: 2064, r: 14 },
		{ x: 228, y: 5680, ele: 2015, r: 60 },
		// Down the north valley, round a tarn on its moor, and round the west end of the massif over a last rise.
		{ x: -800, y: 6400, ele: 1920, r: 150 },
		{ x: -1600, y: 6900, ele: 1850, r: 120 },
		{ x: -2200, y: 6600, ele: 1806, r: 90 },
		{ x: -3000, y: 6800, ele: 1750, r: 120 },
		{ x: -3800, y: 6300, ele: 1680, r: 150 },
		{ x: -4300, y: 5500, ele: 1640, r: 80 },
		{ x: -5200, y: 5200, ele: 1570, r: 100 },
		{ x: -5500, y: 4400, ele: 1530, r: 120 },
		{ x: -6100, y: 3800, ele: 1480, r: 90 },
		{ x: -5600, y: 3000, ele: 1542, r: 100 },
		{ x: -5900, y: 2200, ele: 1470, r: 120 },
		{ x: -5200, y: 1500, ele: 1420, r: 150 },
		{ x: -5300, y: 700, ele: 1400, r: 100 },
		{ x: -4300, y: 300, ele: 1375, r: 150 },
	];
	// A leg between two hairpins bows a little; the valleys' roads wind.
	return wind(
		drawn,
		2101,
		(_, a, b) =>
			a.r <= 14 || b.r <= 14 ? 10 : a.r <= 60 || b.r <= 60 ? 0 : 32,
		215,
	);
}

const peak = (
	at: Spot,
	rise: number,
	spread: number,
	clear?: readonly [number, number],
): Feature => ({ kind: 'peak', at, rise, spread, ...(clear && { clear }) });

/**
 * The land: the col is a notch between two snow peaks that stand right
 * over it, a ridge runs off either way, and beside every other hairpin a
 * crag stands out of the face. Snow lies from 2,350 m, 45 m over the col.
 */
const BERNE_LAND: Feature[] = [
	// The two peaks of the notch, their feet cut by the road's own cuttings.
	peak([-150, 4300], 560, 420, [50, 320]),
	peak([1650, 4350], 640, 460, [50, 320]),
	// The ridge, west and east.
	peak([-1700, 4300], 700, 900),
	peak([3200, 4500], 800, 1000),
	peak([-3300, 3600], 420, 800),
	peak([4600, 3000], 500, 900),
	// Crags beside the hairpins, west and east of the stack by turns, steep enough to stand as rock.
	...[0, 1, 2, 3, 4, 5, 6].flatMap((k): Feature[] => [
		peak([230, 1420 + 345 * k], 70 + 12 * k, 55, [20, 80]),
		peak([955, 1590 + 345 * k], 80 + 12 * k, 60, [20, 80]),
	]),
	// And over the north side's legs.
	peak([60, 5100], 150, 90, [25, 110]),
	peak([1080, 5290], 170, 100, [25, 110]),
	peak([50, 5480], 150, 90, [25, 110]),
	// A stream off the notch's west peak, down the crags beside the hairpins and across the valley road.
	{
		kind: 'stream',
		course: [
			[250, 3900],
			[300, 3300],
			[270, 2600],
			[300, 1900],
			[330, 1300],
			[450, 800],
			[200, 150],
			[-100, -500],
			[-600, -1100],
		],
	},
	// The south valley floor, in the massif's rain shadow.
	{ kind: 'land', cover: 'dry', at: [-1700, 0], radius: 1300 },
	// The north side's tarn on its moor, the road round it, and the stream that feeds it.
	{
		kind: 'lake',
		level: 1790,
		deep: 12,
		basin: { slope: 0.2, reach: 320 },
		shore: [
			[-2100, 6960],
			[-2190, 7100],
			[-2360, 7110],
			[-2440, 6970],
			[-2370, 6830],
			[-2200, 6830],
		],
	},
	{ kind: 'land', cover: 'moor', at: [-2300, 6850], radius: 800 },
	{
		kind: 'stream',
		course: [
			[-2100, 8300],
			[-2350, 7700],
			[-2250, 7300],
			[-2280, 7050],
		],
	},
];

/**
 * Aarenbogen: a river in a gorge winds round a peninsula, as the one a
 * capital stands on, and the road crosses it four times on bridges 50 m
 * over the water, then climbs a spur over the bend.
 */
const AARENBOGEN: Corner[] = wind(
	[
		{ x: -2600, y: 200, ele: 548, r: 150 },
		{ x: -2000, y: 450, ele: 566, r: 100 },
		{ x: -600, y: 250, ele: 552, r: 120 },
		{ x: 300, y: 500, ele: 570, r: 80 },
		{ x: 1500, y: 300, ele: 550, r: 100 },
		{ x: 2000, y: 750, ele: 590, r: 60 },
		{ x: 2600, y: 900, ele: 575, r: 120 },
		{ x: 3900, y: 1500, ele: 566, r: 100 },
		{ x: 4500, y: 1350, ele: 585, r: 60 },
		{ x: 4750, y: 700, ele: 560, r: 80 },
		{ x: 4300, y: -700, ele: 552, r: 90 },
		{ x: 3500, y: -800, ele: 575, r: 70 },
		// The ramp: 1.4 km at 8 % up to a spur over the river's bend, and a steep way down.
		{ x: 2800, y: -1300, ele: 530, r: 120 },
		{ x: 2200, y: -950, ele: 585, r: 50 },
		{ x: 1500, y: -1000, ele: 640, r: 80 },
		{ x: 1100, y: -1500, ele: 600, r: 40 },
		{ x: 600, y: -1700, ele: 548, r: 100 },
		// The moor on the plateau, and the rollers home.
		{ x: -200, y: -1850, ele: 560, r: 80 },
		{ x: -1000, y: -1500, ele: 545, r: 100 },
		{ x: -1700, y: -1450, ele: 575, r: 60 },
		{ x: -2400, y: -900, ele: 550, r: 120 },
		{ x: -2900, y: -300, ele: 562, r: 100 },
	],
	4404,
	// The four legs that cross the river stay straight: a bridge has no bend in it.
	(leg) => ([1, 3, 6, 9].includes(leg) ? 0 : 30),
	270,
	3,
);

const AARENBOGEN_LAND: Feature[] = [
	{
		kind: 'river',
		course: [
			[-4300, 1550],
			[-4000, 1500],
			[-2500, 1300],
			[-1500, 600],
			[-1200, -600],
			[-300, -1100],
			[700, -700],
			[900, 400],
			[300, 1300],
			[700, 2200],
			[1900, 2500],
			[3000, 1900],
			[3300, 700],
			[4200, 0],
			[5500, 200],
			[6400, -50],
		],
		width: 70,
		level: 500,
		// Steep enough to be a gorge, gentle enough to be wooded: rock starts at 0.85.
		gorge: { bank: 15, slope: 0.6 },
	},
	// The hills the river comes out of and runs off between.
	peak([-3800, -2800], 220, 900),
	peak([2400, 4200], 260, 1000),
	peak([6200, 2600], 200, 900),
	peak([1200, -3600], 180, 800),
	// Knolls the road bends round: what lies past the bend is not seen from before it.
	peak([150, 900], 70, 200, [30, 150]),
	peak([3900, 900], 80, 250, [30, 150]),
	peak([2300, -1500], 70, 200, [30, 150]),
	peak([-1900, -800], 80, 250, [40, 160]),
	// Streams off the hills into the river: under the road, or beside it.
	{
		kind: 'stream',
		course: [
			[1300, -2900],
			[1000, -2200],
			[900, -1500],
			[800, -900],
			[700, -700],
			[550, -450],
		],
	},
	{
		kind: 'stream',
		course: [
			[-3600, -2400],
			[-3000, -1500],
			[-2700, -700],
			[-2200, -100],
			[-1700, 300],
			[-1450, 450],
		],
	},
	{
		kind: 'stream',
		course: [
			[5800, 2300],
			[5300, 1500],
			[5000, 800],
			[4900, 300],
			[4800, 100],
		],
	},
	{ kind: 'land', cover: 'moor', at: [-500, -2000], radius: 650 },
];

/**
 * Urnsee: a long lake between mountains, the road on a ledge along its east
 * shore under the cliffs, over an inlet on a bridge, round the head of the
 * lake and up to a terrace 270 m over the west shore.
 */
const URNSEE_DRAWN: Corner[] = [
	// The east shore: 6 to 10 m over the water, so the lake lies open beside the road.
	{ x: 700, y: -4750, ele: 440, r: 200 },
	{ x: 1180, y: -3900, ele: 441, r: 200 },
	// A headland: up over the cliffs and down to the water again.
	{ x: 1420, y: -2500, ele: 480, r: 300 },
	{ x: 1230, y: -1000, ele: 441, r: 300 },
	{ x: 1610, y: 400, ele: 444, r: 250 },
	{ x: 1640, y: 1250, ele: 444, r: 250 },
	{ x: 1330, y: 2050, ele: 442, r: 250 },
	{ x: 830, y: 3350, ele: 460, r: 250 },
	{ x: 50, y: 4130, ele: 440, r: 200 },
	{ x: -800, y: 3700, ele: 455, r: 150 },
	// The terrace: back from the west shore and over it, up and down from one spur to the next, as high as a bank of 1.5:1 lets a road stand over water.
	{ x: -1300, y: 3050, ele: 500, r: 80 },
	{ x: -1350, y: 2300, ele: 520, r: 120 },
	{ x: -1500, y: 1600, ele: 575, r: 60 },
	{ x: -950, y: 900, ele: 545, r: 90 },
	{ x: -1400, y: 150, ele: 590, r: 70 },
	{ x: -1250, y: -600, ele: 560, r: 100 },
	{ x: -1500, y: -1400, ele: 600, r: 70 },
	{ x: -1050, y: -2200, ele: 520, r: 90 },
	{ x: -1350, y: -2900, ele: 505, r: 80 },
	{ x: -1150, y: -3600, ele: 470, r: 120 },
	{ x: -400, y: -4500, ele: 442, r: 150 },
];
/** The shore road sways with the shore, its bridge straight; the terrace's winds. */
const URNSEE = wind(
	URNSEE_DRAWN,
	4340,
	(leg) =>
		leg === 4 ? 0 : leg >= 1 && leg <= 8 ? 16 : leg === 0 || leg >= 21 ? 0 : 28,
	270,
);

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
const U = URNSEE_DRAWN;

const URNSEE_LAND: Feature[] = [
	{
		kind: 'lake',
		level: 434,
		deep: 40,
		basin: { slope: 0.5, reach: 450 },
		shore: [
			...beside(U[1], U[2], SHORE_M, [0, 0.33, 0.66]),
			...beside(U[2], U[3], SHORE_M, [0, 0.33, 0.66]),
			...beside(U[3], U[4], SHORE_M, [0, 0.33, 0.66, 1]),
			...beside(U[4], U[5], SHORE_M, [0.4, 0.85]),
			// The inlet the east shore's road bridges, a stream's mouth.
			[2050, 1170],
			[2050, 1340],
			...beside(U[5], U[6], SHORE_M, [0.12, 0.45, 1]),
			...beside(U[6], U[7], SHORE_M, [0.33, 0.66, 1]),
			...beside(U[7], U[8], SHORE_M, [0.5, 1]),
			...beside(U[8], U[9], SHORE_M, [0.5, 1]),
			[-1100, 2300],
			[-700, 900],
			[-1000, -600],
			[-800, -2200],
			[-900, -3600],
			[-350, -4400],
			[620, -4640],
		],
	},
	// The east wall, over the ledge.
	peak([2500, -1800], 440, 800, [40, 300]),
	peak([2700, -300], 520, 850, [40, 300]),
	peak([2900, 2700], 480, 850, [40, 300]),
	peak([1760, -1900], 90, 70, [30, 110]),
	peak([1640, -400], 100, 75, [30, 110]),
	peak([1980, 700], 110, 80, [30, 110]),
	peak([1700, 2700], 100, 75, [30, 110]),
	// The west side's mountains, behind the terrace, and the head of the lake.
	peak([-2900, 100], 900, 1000),
	peak([-2700, -2700], 700, 900),
	peak([-500, 5400], 600, 800),
	peak([-2600, 3000], 500, 800),
	// Streams off both walls into the lake, white where the walls are steep: one into the inlet, the others under the road.
	{
		kind: 'stream',
		course: [
			[3500, 1200],
			[2950, 1280],
			[2600, 1240],
			[2300, 1255],
			[1950, 1255],
		],
	},
	{
		kind: 'stream',
		course: [
			[2700, -1150],
			[2100, -1050],
			[1700, -1000],
			[1250, -1000],
			[1100, -1000],
		],
	},
	{
		kind: 'stream',
		course: [
			[-2500, 250],
			[-1900, 150],
			[-1400, 500],
			[-1000, 450],
			[-600, 450],
		],
	},
	{
		kind: 'stream',
		course: [
			[-2400, -2600],
			[-1700, -2400],
			[-1200, -2350],
			[-700, -2300],
		],
	},
	// Reeds and bog at the head of the lake.
	{ kind: 'land', cover: 'moor', at: [50, 4400], radius: 600 },
];

export const DESIGNS: readonly Designed[] = [
	{
		id: 'berne',
		lengthM: 31726.23,
		shape: { corners: colDeBerne(), seed: 2101, drawn: true },
		features: BERNE_LAND,
		// Snow from 2,050 m, eight hairpins under the col, and the forest up into it: the last trees stand white.
		climate: { snowline: 2050, treeline: 2230 },
	},
	{
		id: 'aare',
		lengthM: 18591.45,
		shape: { corners: AARENBOGEN, seed: 4404, drawn: true },
		features: AARENBOGEN_LAND,
	},
	{
		id: 'urnsee',
		lengthM: 20814.46,
		shape: { corners: URNSEE, seed: 4340, drawn: true },
		features: URNSEE_LAND,
	},
];
