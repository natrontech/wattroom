/**
 * WattRoom's map (designed.ts): one made-up land, its roads and what lies
 * round them drawn on it together, and the loops a rider picks through it.
 * A lake between mountains, the river that leaves it through a gorge, a
 * pass over the massif east of both; west over the alp, a second, wider
 * valley of fields. Named after Swiss places a rider knows and shaped like
 * them from memory, never traced: no coordinate here is a place's, and each
 * name is changed.
 *
 * Metres east and north of the map's own origin; heights above sea. Every
 * loop is built of the same stretches of road between the same nodes, so
 * two loops that share a stretch share it to the metre.
 */
import type { Designed, Feature, Lane, Spot } from './designed';
import { prng } from './rand';
import type { Corner } from './synthetic';

/**
 * A stretch of road with its long legs wound: no road runs a kilometre dead
 * straight. Each leg gets a point every `every` metres, set off to one side
 * and the other by turns, up to `amp(leg)` metres, and its height rolled by
 * up to `roll`: 0 keeps a leg as drawn, a bridge's, a tunnel's or a hairpin's.
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

/** The nodes every loop is built between: the village south of the lake, the head of the lake, and the crossroads on the plateau west of the gorge. */
// Each is a roundabout (through, below): its centre here.
const HUB: Corner = { x: 200, y: 300, ele: 1446, r: 0 };
const HEAD: Corner = { x: 150, y: 4250, ele: 1441, r: 0 };
const WEST: Corner = { x: -2650, y: -1750, ele: 1462, r: 0 };

/** A roundabout: the radius of its ring's centre line, how far out each arm runs straight at it, and the radius a line turns onto the ring or off it on: tight, so an arm is one straight road to the ring's edge, the same for the way in and the way out. */
const RING = { r: 18, stub: 70, level: 160, arm: 3 };

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
 * The east shore, hub to the head of the lake. Past the village's beach and
 * round Schifftritt's bay a few metres over the water, up and through the
 * Nase headland in a tunnel, under the cliffs through a gallery, across the
 * inlet's mouth on a bridge, and along the shore to the reeds at the head.
 */
const SHORE_DRAWN: Corner[] = [
	{ x: 450, y: 590, ele: 1439, r: 120 },
	{ x: 640, y: 830, ele: 1438, r: 120 },
	{ x: 800, y: 1010, ele: 1437, r: 100 },
	// Schifftritt, on the bay's far side.
	{ x: 960, y: 1240, ele: 1438, r: 90 },
	{ x: 900, y: 1450, ele: 1451, r: 90 },
	// The Nase: its tunnel's leg straight.
	{ x: 800, y: 1610, ele: 1461, r: 80 },
	{ x: 770, y: 2010, ele: 1462, r: 80 },
	{ x: 900, y: 2250, ele: 1455, r: 100 },
	// Under the cliffs, 24 m over the water: the gallery.
	{ x: 930, y: 2450, ele: 1458, r: 120 },
	{ x: 920, y: 2820, ele: 1457, r: 120 },
	// The inlet's mouth: its bridge's leg straight.
	{ x: 935, y: 3080, ele: 1449, r: 150 },
	{ x: 905, y: 3560, ele: 1444, r: 120 },
	{ x: 870, y: 3760, ele: 1441, r: 120 },
	{ x: 560, y: 3980, ele: 1440, r: 100 },
];
const SHORE = stretch(HUB, SHORE_DRAWN, HEAD, 4340, (leg) =>
	leg === 5 || leg === 10 ? 0 : leg >= 7 && leg <= 9 ? 8 : 16,
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
		{ x: -750, y: 500, ele: 1497, r: 60 },
	],
	HUB,
	4341,
	() => 26,
);

/**
 * The gorge, from the village out over a spur in the river's bend, across
 * the river on a high bridge, along the gorge's rim and through a rib of its
 * rock in a tunnel, and round the moor on the plateau to the crossroads
 * there; and from the crossroads back over the river into the village.
 */
const GORGE_OUT = stretch(
	HUB,
	[
		// The spur: 1.6 km up from the village, the last 900 m at 9 %, and off it on a viaduct 130 m over the river.
		{ x: 300, y: -350, ele: 1472, r: 60 },
		{ x: 100, y: -1250, ele: 1552, r: 60 },
		{ x: 1250, y: -1450, ele: 1490, r: 80 },
		{ x: 1150, y: -2150, ele: 1450, r: 80 },
		{ x: 300, y: -2500, ele: 1470, r: 140 },
		{ x: -400, y: -2950, ele: 1445, r: 100 },
		{ x: -1500, y: -3100, ele: 1462, r: 100 },
		{ x: -2700, y: -2300, ele: 1452, r: 100 },
	],
	WEST,
	4404,
	// The leg that crosses the river and the one through the rib stay straight: a bridge and a tunnel have no bend in them.
	(leg) => (leg === 2 || leg === 3 ? 0 : 28),
	270,
	3,
);
const GORGE_HOME = stretch(
	WEST,
	[
		{ x: -2600, y: -1300, ele: 1480, r: 80 },
		{ x: -1800, y: -1000, ele: 1455, r: 70 },
		{ x: -1100, y: -800, ele: 1450, r: 80 },
	],
	HUB,
	4405,
	(leg) => (leg === 3 ? 0 : 28),
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
			{ x: 1250, y: -200, ele: 1462, r: 120 },
			{ x: 2000, y: -1100, ele: 1485, r: 120 },
			{ x: 2700, y: -1700, ele: 1505, r: 100 },
			{ x: 3500, y: -1750, ele: 1522, r: 80 },
			...legs,
			{ x: 3300, y: 1650, ele: 2310, r: 60 },
			...down,
			// The north valley, down past the tarn to the lake.
			{ x: 2200, y: 4900, ele: 1690, r: 100 },
			{ x: 1400, y: 4700, ele: 1622, r: 100 },
			{ x: 800, y: 5000, ele: 1552, r: 80 },
			{ x: 300, y: 4900, ele: 1506, r: 60 },
			{ x: 480, y: 4600, ele: 1468, r: 40 },
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

/**
 * The Kettental road, from the head of the lake the long way to the
 * crossroads on the plateau: up the side valley and its Z of four hairpins
 * onto the alp, along the alp's lake, south on the ridge over Speichenegg
 * with the Kettental under it, down its west face in four hairpins, the
 * length of the valley's fields and through its village, and back east up
 * the forest to the plateau.
 */
const KETTE_DRAWN: Corner[] = [
	// The side valley.
	{ x: -150, y: 4800, ele: 1458, r: 100 },
	{ x: -180, y: 5350, ele: 1492, r: 100 },
	{ x: -480, y: 5800, ele: 1528, r: 60 },
	// The Z up its west side: six ramps of 7–8 %, five hairpins.
	{ x: -1200, y: 5980, ele: 1580, r: 24 },
	{ x: -620, y: 6250, ele: 1627, r: 24 },
	{ x: -1300, y: 6500, ele: 1680, r: 24 },
	{ x: -700, y: 6780, ele: 1730, r: 24 },
	{ x: -1400, y: 7020, ele: 1784, r: 24 },
	{ x: -1850, y: 7330, ele: 1820, r: 80 },
	// Onto the alp, along its lake's north shore.
	{ x: -2450, y: 7250, ele: 1842, r: 120 },
	{ x: -3100, y: 7050, ele: 1850, r: 120 },
	{ x: -3650, y: 6650, ele: 1856, r: 120 },
	// The ridge: out to its north end, and south along the crest over Speichenegg.
	{ x: -4250, y: 7050, ele: 1866, r: 120 },
	{ x: -4650, y: 7450, ele: 1876, r: 100 },
	{ x: -5100, y: 6850, ele: 1888, r: 120 },
	{ x: -4850, y: 6150, ele: 1898, r: 150 },
	{ x: -4650, y: 5550, ele: 1906, r: 150 },
	{ x: -4550, y: 4850, ele: 1924, r: 150 },
	{ x: -4800, y: 4100, ele: 1898, r: 150 },
	{ x: -4750, y: 3400, ele: 1866, r: 100 },
	// Down the west face: six hairpins, and the long traverse to the valley's head.
	{ x: -5300, y: 3100, ele: 1826, r: 80 },
	{ x: -5950, y: 3350, ele: 1778, r: 24 },
	{ x: -5450, y: 3700, ele: 1730, r: 24 },
	{ x: -6100, y: 3950, ele: 1680, r: 24 },
	{ x: -5550, y: 4300, ele: 1632, r: 24 },
	{ x: -6200, y: 4550, ele: 1583, r: 24 },
	{ x: -5750, y: 4900, ele: 1540, r: 24 },
	{ x: -6450, y: 5100, ele: 1492, r: 80 },
	{ x: -7000, y: 5450, ele: 1462, r: 120 },
	{ x: -7600, y: 5200, ele: 1440, r: 120 },
	// The Kettental, south through its fields, over its river twice, through Nabenwil.
	{ x: -7950, y: 4000, ele: 1418, r: 200 },
	{ x: -7400, y: 2800, ele: 1402, r: 150 },
	{ x: -7600, y: 1500, ele: 1388, r: 150 },
	{ x: -7350, y: 600, ele: 1376, r: 200 },
	{ x: -7700, y: -500, ele: 1365, r: 150 },
	{ x: -7200, y: -1800, ele: 1352, r: 150 },
	{ x: -7500, y: -3000, ele: 1338, r: 150 },
	{ x: -7100, y: -4000, ele: 1328, r: 200 },
	{ x: -7300, y: -4900, ele: 1318, r: 150 },
	// Out of the valley and east, up through the forest to the plateau, a hairpin in it.
	{ x: -6700, y: -5700, ele: 1310, r: 150 },
	{ x: -5600, y: -5900, ele: 1324, r: 150 },
	{ x: -4500, y: -5300, ele: 1350, r: 150 },
	{ x: -3800, y: -4500, ele: 1378, r: 40 },
	{ x: -4250, y: -3900, ele: 1402, r: 30 },
	{ x: -3500, y: -3400, ele: 1424, r: 100 },
	{ x: -3150, y: -2700, ele: 1440, r: 120 },
	{ x: -3050, y: -2150, ele: 1452, r: 100 },
];
/** The legs that carry the valley road over its river: from these corners, straight. */
const KETTE_BRIDGES = [
	[-7400, 2800],
	[-7200, -1800],
].map(([x, y]) => KETTE_DRAWN.findIndex((c) => c.x === x && c.y === y) + 1);
const KETTE = stretch(
	HEAD,
	KETTE_DRAWN,
	WEST,
	5050,
	// The river's two bridges run as drawn, the hairpins' ramps nearly; the valleys' roads wind.
	(leg, a, b) =>
		KETTE_BRIDGES.includes(leg)
			? 0
			: a.r <= 40 || b.r <= 40
				? 6
				: a.r >= 150 && b.r >= 150
					? 42
					: 30,
	270,
	2,
);

const peak = (
	at: Spot,
	rise: number,
	spread: number,
	clear?: readonly [number, number],
): Feature => ({ kind: 'peak', at, rise, spread, ...(clear && { clear }) });

const lane = (...course: Spot[]): Lane => ({ kind: 'gravel', course });

const LAND: Feature[] = [
	// The lake, 1,434 m: a beach by the village, Schifftritt's bay, the Nase headland, cliffs, an inlet, the reeds of a delta at its head, and a headland and an island on the west.
	{
		kind: 'lake',
		level: 1434,
		deep: 60,
		basin: { slope: 0.5, reach: 450 },
		shore: [
			// The beach, by the village.
			[-250, 830],
			[-80, 720],
			[140, 680],
			[330, 720],
			[470, 800],
			// Schifftritt's bay.
			[560, 900],
			[670, 1020],
			[790, 1110],
			[850, 1210],
			[820, 1310],
			[730, 1360],
			// The Nase, out into the lake.
			[640, 1450],
			[500, 1600],
			[360, 1720],
			[260, 1830],
			[250, 1930],
			[350, 2010],
			[520, 2090],
			[680, 2170],
			// Under the cliffs.
			[790, 2290],
			[850, 2450],
			[860, 2650],
			[840, 2850],
			[830, 3050],
			[850, 3170],
			// The inlet.
			[960, 3230],
			[1150, 3270],
			[1240, 3350],
			[1150, 3430],
			[980, 3420],
			[840, 3480],
			[740, 3640],
			[600, 3800],
			[470, 3920],
			[360, 4000],
			// The delta at its head, a lobe each side of the stream.
			[250, 4040],
			[160, 4110],
			[80, 4090],
			[20, 4140],
			[-60, 4100],
			[-150, 4060],
			[-260, 4010],
			// The west shore: its bay, and its headland facing the Nase across the narrows.
			[-380, 3900],
			[-470, 3700],
			[-480, 3450],
			[-560, 3100],
			[-680, 2800],
			[-760, 2500],
			[-680, 2250],
			[-450, 2100],
			[-200, 1990],
			[-110, 1880],
			[-200, 1780],
			[-420, 1650],
			[-560, 1450],
			[-540, 1180],
			[-420, 960],
		],
		islands: [
			[
				[-60, 2600],
				[20, 2560],
				[110, 2590],
				[130, 2670],
				[60, 2720],
				[-30, 2700],
			],
		],
		shallows: [
			{ at: [130, 720], radius: 280 },
			{ at: [20, 4100], radius: 260 },
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
			[1800, -5600],
			[1650, -6900],
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
			[-170, 770],
			[-230, 520],
			[-290, 250],
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
	// Cliffs over the east shore, the gallery under them.
	peak([1080, 1300], 90, 70, [30, 110]),
	peak([1100, 2620], 130, 90, [20, 90]),
	peak([1130, 2900], 100, 75, [30, 110]),
	// The Nase: a wooded rib out into the lake, the shore road through it.
	peak([640, 1830], 70, 170, [8, 45]),
	peak([420, 1870], 35, 110, [8, 45]),
	// The rib of rock the gorge road tunnels through.
	peak([1200, -1800], 45, 75, [6, 30]),
	// The west side's mountains, behind the terrace; and over the head of the lake, east of the side valley.
	peak([-2700, 2300], 750, 850),
	peak([-2400, 4400], 500, 800),
	// And between them and the ridge, the high valleys they stand over: the alp's stream runs down one.
	peak([-3500, 3500], -300, 800),
	peak([-3700, 1100], -320, 900),
	peak([-4300, -900], -200, 800),
	peak([-2800, 5300], -250, 600),
	peak([900, 6300], 450, 600),
	// The hills the river runs off between, and a knoll the gorge road bends round.
	peak([-3600, -500], 220, 900),
	peak([-1800, -4300], 200, 900),
	peak([900, -3900], 180, 800),
	peak([-1700, -1900], 70, 220, [40, 160]),

	// The alp: its lake at 1,838 m under the ridge, and the stream out of it down to the head of the lake.
	{
		kind: 'lake',
		level: 1838,
		deep: 22,
		basin: { slope: 0.3, reach: 300 },
		shore: [
			[-2350, 7120],
			[-2700, 7130],
			[-3050, 6950],
			[-3450, 6640],
			[-3600, 6450],
			[-3400, 6300],
			[-3000, 6400],
			[-2600, 6650],
			[-2300, 6900],
		],
	},
	{
		kind: 'stream',
		course: [
			[-3380, 6290],
			[-3100, 5700],
			[-2600, 5300],
			[-1900, 5000],
			[-1100, 4700],
			[-600, 4350],
			[-330, 4060],
		],
	},
	// The peaks round the alp, and the ridge's own summit knolls.
	peak([-3000, 8300], 450, 700),
	peak([-4000, 7700], 380, 500),
	peak([-1900, 6100], 160, 350, [60, 250]),
	peak([-3700, 5200], 220, 450, [80, 300]),

	// The Kettental: a wide valley of fields between two ranges, falling south.
	peak([-10200, 4200], 700, 1200),
	peak([-10400, -900], 650, 1200),
	peak([-10000, -5200], 500, 1000),
	peak([-9400, 7800], 600, 900),
	peak([-5600, 1600], 520, 900, [120, 600]),
	peak([-5300, -1500], 380, 800, [120, 600]),
	peak([-6000, 6600], 420, 700, [120, 600]),
	// Its river, 15 m of water between bars of gravel, from the valley's head off south beside the valley road, under it twice: its floor the valley's fields.
	{
		kind: 'stream',
		course: [
			[-8250, 8400],
			[-8080, 7300],
			[-7960, 6300],
			[-7840, 5300],
			[-8180, 4000],
			[-7630, 2800],
			[-7370, 1500],
			[-7120, 600],
			[-7470, -500],
			[-6970, -1800],
			[-7730, -3000],
			[-7330, -4000],
			[-7530, -4900],
			[-7600, -6900],
		],
		levels: [
			1532, 1494, 1462, 1435, 1413, 1397, 1383, 1371, 1360, 1347, 1333, 1323,
			1313, 1292,
		],
		width: 15,
		cut: 5,
		plain: { bank: 380, slope: 0.35 },
		gravel: 15,
	},
	// Streams off the ranges into it.
	{
		kind: 'stream',
		course: [
			[-5300, 2700],
			[-5900, 2300],
			[-6400, 1900],
			[-6900, 1700],
			[-7400, 1750],
		],
	},
	{
		kind: 'stream',
		course: [
			[-9900, 1500],
			[-9200, 1300],
			[-8600, 1000],
			[-8000, 900],
			[-7250, 1000],
		],
	},
	{
		kind: 'stream',
		course: [
			[-5200, -3200],
			[-5800, -2900],
			[-6400, -2600],
			[-7000, -2300],
			[-7300, -2330],
		],
	},

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
			[2000, 3330],
			[1500, 3360],
			[1300, 3345],
			[1190, 3345],
		],
	},
	{
		kind: 'stream',
		course: [
			[1900, 1450],
			[1400, 1450],
			[1100, 1250],
			[900, 1180],
			[820, 1200],
		],
	},
	{
		kind: 'stream',
		course: [
			[-2400, 2950],
			[-1800, 2800],
			[-1300, 2500],
			[-900, 2380],
			[-700, 2380],
		],
	},
	// Down the side valley into the head of the lake: its delta.
	{
		kind: 'stream',
		course: [
			[-200, 7200],
			[-80, 6400],
			[80, 5600],
			[60, 5000],
			[40, 4500],
			[25, 4150],
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

	// Ground laid by hand. Bogs: the tarn's moor, the plateau's, the reeds of the delta and a wet meadow in the Kettental's bend.
	{ kind: 'land', cover: 'moor', at: [1150, 5100], radius: 750 },
	{ kind: 'land', cover: 'moor', at: [-2300, -2100], radius: 800 },
	{ kind: 'land', cover: 'moor', at: [40, 4160], radius: 230 },
	{ kind: 'land', cover: 'moor', at: [-8300, 3700], radius: 380 },
	// The valley under the climb, in the massif's rain shadow; and the village's beach.
	{ kind: 'land', cover: 'dry', at: [2300, -1500], radius: 1000 },
	{ kind: 'land', cover: 'dry', at: [130, 690], radius: 130 },
	// Alp: open pasture round the alp's lake, along the ridge, over the terrace.
	{ kind: 'land', cover: 'alp', at: [-3000, 6800], radius: 1100 },
	{ kind: 'land', cover: 'alp', at: [-4650, 6300], radius: 800 },
	{ kind: 'land', cover: 'alp', at: [-4600, 4900], radius: 800 },
	{ kind: 'land', cover: 'alp', at: [-4800, 3800], radius: 550 },
	{ kind: 'land', cover: 'alp', at: [-2050, 2500], radius: 450 },
	{ kind: 'land', cover: 'alp', at: [1700, 6500], radius: 550 },
	// Scree under the cliffs: over the gallery, under the notch, off the west mountain, at the foot of the Kettental's ranges.
	{ kind: 'land', cover: 'scree', at: [1170, 2700], radius: 170 },
	{ kind: 'land', cover: 'scree', at: [2600, 2050], radius: 260 },
	{ kind: 'land', cover: 'scree', at: [-2150, 2800], radius: 280 },
	{ kind: 'land', cover: 'scree', at: [-5150, 4500], radius: 220 },
	{ kind: 'land', cover: 'scree', at: [-9300, -400], radius: 380 },
	{ kind: 'land', cover: 'scree', at: [-9000, 5300], radius: 300 },
	// Fields: the Kettental's floor, and the village's south of the lake.
	{
		kind: 'land',
		cover: 'fields',
		area: [
			[-8150, 5100],
			[-7350, 5150],
			[-7100, 3400],
			[-6950, 1900],
			[-6500, 1200],
			[-6500, -600],
			[-6750, -2800],
			[-6950, -4100],
			[-7500, -4600],
			[-8350, -3700],
			[-8700, -1300],
			[-8600, 1200],
			[-8700, 2800],
		],
	},
	{
		kind: 'land',
		cover: 'fields',
		area: [
			[-350, -250],
			[250, -700],
			[950, -700],
			[1050, -150],
			[700, 120],
			[150, 30],
		],
	},
	// Woods where the generator would mow: the Kettental's slopes, the forest the road climbs back through, the descent's face.
	{ kind: 'land', cover: 'wood', at: [-6000, -200], radius: 650 },
	{ kind: 'land', cover: 'wood', at: [-8950, -2300], radius: 600 },
	{ kind: 'land', cover: 'wood', at: [-4300, -4200], radius: 750 },
	{ kind: 'land', cover: 'wood', at: [-5850, 4100], radius: 520 },
	{ kind: 'land', cover: 'wood', at: [-1000, 4600], radius: 420 },
];

/** The map's loops, by id: each draws the others' roads where they leave it, so every loop rides one land. */
const LOOP_IDS = ['urnsee', 'aare', 'lac', 'berne', 'kette'];

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
			{ name: 'Morschachli', at: [900, 2250] },
			{ name: 'Bantigeregg', at: [100, -1250] },
			{ name: 'Längenhubel', at: [-2600, -1300] },
			{ name: 'Speichenegg', at: [-4550, 4850] },
			{ name: 'Nabenalp', at: [-3650, 6650] },
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
		// The hamlet on the east shore, its harbour where the road comes off the inlet's bridge onto the shore, ahead of a rider all the way over it (the bay's bank hid it from the road); and the Kettental's village.
		hamlets: [
			{ name: 'Schifftritt', at: [960, 1240], harbour: [870, 3485] },
			{ name: 'Nabenwil', at: [-7350, 600] },
		],
	},
	galleries: [
		// Under the east shore's cliffs, the lake seen between its pillars; and an avalanche gallery high on the climb.
		[
			[930, 2470],
			[921, 2800],
		],
		[
			[3340, 882],
			[3080, 955],
		],
	],
	tunnels: [
		// Through the root of the Nase, on the east shore.
		[
			[797, 1660],
			[773, 1960],
		],
		// Through a rib of rock on the gorge's rim.
		[
			[1212, -1716],
			[1188, -1884],
		],
		// Through the spur the north valley's road cuts deepest into, by the tarn: the col's road, its hill some 24 m over it.
		[
			[976, 4937],
			[678, 4976],
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
			{ x: 950, y: -5200, ele: 1420, r: 0 },
			{ x: 900, y: -6900, ele: 1410, r: 0 },
		],
		// Off the valley road under the climb, square to it, then out through the dry valley: a road leaving another at a shallow angle runs beside it and reads as a mistake.
		[
			{ x: 2000, y: -1100, ele: 1485, r: 0 },
			{ x: 1750, y: -1400, ele: 1480, r: 0 },
			{ x: 1900, y: -2000, ele: 1476, r: 0 },
			{ x: 2700, y: -2600, ele: 1488, r: 0 },
			{ x: 3700, y: -2700, ele: 1505, r: 0 },
			{ x: 4900, y: -2500, ele: 1530, r: 0 },
		],
		// The Kettental's road on down the valley: off the outside of the loop's bend out of it, square to it, then south. Run on straight from the bend it left at a shallow angle and ended beside the loop's road, never meeting it.
		[
			{ x: -7285, y: -4897, ele: 1318, r: 0 },
			{ x: -7355, y: -4912, ele: 1317, r: 0 },
			{ x: -7380, y: -5800, ele: 1310, r: 0 },
			{ x: -7250, y: -6800, ele: 1302, r: 0 },
		],
		// Gravel: up the Kettental to its head, and farm tracks across its fields, to its farms and over its river.
		lane(
			[-7000, 5450],
			[-7050, 6150],
			[-7350, 7050],
			[-7700, 7800],
			[-7900, 8300],
		),
		lane([-7950, 4000], [-8450, 3900], [-9000, 4250], [-9800, 4450]),
		lane([-6950, 3060], [-7300, 2950], [-7700, 2850], [-8050, 2650]),
		lane([-7350, 600], [-6800, 760], [-6300, 1150], [-5850, 1300]),
		lane([-7350, 600], [-8000, 350], [-8600, 500], [-9800, 250]),
		lane([-7700, -500], [-8400, -800], [-8950, -1550]),
		lane([-7500, -3000], [-8200, -3250], [-8750, -3750]),
		// Forest roads up the valley's sides and off the climb back to the plateau.
		lane([-7200, -1800], [-6600, -1700], [-6100, -1200], [-5700, -700]),
		lane([-3500, -3400], [-4100, -3050], [-4800, -2700], [-5400, -2000]),
		// Over the plateau: south off the gorge road, and north off its way home.
		lane([-1500, -3100], [-1300, -3800], [-1000, -4600], [-800, -6900]),
		lane([-1800, -1000], [-2200, -500], [-2900, -200], [-3500, 300]),
		// By the village: out through its fields, and down to its beach.
		lane([300, -350], [750, -480], [1100, -650]),
		lane([450, 590], [260, 620], [90, 650]),
		// A farm lane north off the valley road.
		lane([1250, -200], [1500, 250], [2000, 600]),
		// Up from the terrace to its alp, and down to the west headland's shore.
		lane([-1500, 2100], [-2000, 2400], [-2400, 2900]),
		lane([-900, 1500], [-600, 1700], [-350, 1850]),
		// Across the side valley from the Kettental road to the col's, over the delta's stream.
		lane([-180, 5350], [150, 5450], [500, 5150], [550, 4955]),
		// Up the north valley's forest, through the dry valley, and on up the alp.
		lane([1400, 4700], [1600, 5400], [1800, 6200]),
		lane([2700, -2600], [2500, -3400], [2700, -4300], [2600, -6900]),
		lane([-3100, 7050], [-3000, 7600], [-2800, 8300]),
	],
	rings: [HUB, HEAD, WEST].map((node) => ({
		at: [node.x, node.y] as const,
		r: RING.r,
		ele: node.ele,
		// The bearings its arms leave on, anticlockwise from east: each road through it adds its own (through).
		arms: [] as number[],
		statue: node === HUB ? ('bicycle' as const) : ('cow' as const),
	})),
} satisfies Pick<
	Designed,
	'features' | 'climate' | 'names' | 'galleries' | 'tunnels' | 'spurs' | 'rings'
>;

const loop = (
	id: string,
	lengthM: number,
	seed: number,
	corners: Corner[],
): Designed => ({
	id,
	lengthM,
	shape: { corners, seed, drawn: true },
	others: LOOP_IDS.filter((o) => o !== id),
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
	// The pond by the first straight, shallow all over, and the stream out of it.
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
		shallows: [{ at: [1310, 290], radius: 220 }],
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
			[3950, -1600],
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
	// Ground laid by hand. The pond's reeds, and a wet meadow by the river.
	{ kind: 'land', cover: 'moor', at: [1310, 300], radius: 230 },
	{ kind: 'land', cover: 'moor', at: [600, 2350], radius: 420 },
	// Woods by the farms: round the knoll, behind the north road's farms, on the east bank.
	{ kind: 'land', cover: 'wood', at: [2050, 1450], radius: 230 },
	{ kind: 'land', cover: 'wood', at: [3550, 3250], radius: 200 },
	{ kind: 'land', cover: 'wood', at: [1750, 4650], radius: 260 },
	{ kind: 'land', cover: 'wood', at: [-250, 1500], radius: 180 },
	{ kind: 'land', cover: 'wood', at: [5500, 600], radius: 220 },
	// Fields: the floor inside the loop either side of the river, south of the first straight, and over the north road.
	{
		kind: 'land',
		cover: 'fields',
		area: [
			[-250, 1900],
			[150, 1150],
			[150, 450],
			[950, 350],
			[1000, 1000],
			[1250, 1750],
			[1050, 1950],
			[300, 1950],
		],
	},
	{
		kind: 'land',
		cover: 'fields',
		area: [
			[2300, 300],
			[3300, 400],
			[3400, 1200],
			[2900, 1700],
			[2350, 1700],
			[2150, 900],
		],
	},
	{
		kind: 'land',
		cover: 'fields',
		area: [
			[1500, 2600],
			[2000, 3000],
			[3000, 2550],
			[3900, 2250],
			[4600, 2150],
			[4500, 2900],
			[3800, 3600],
			[2600, 3950],
			[1500, 3650],
		],
	},
	{
		kind: 'land',
		cover: 'fields',
		area: [
			[100, -200],
			[2600, -250],
			[3000, -700],
			[2400, -1200],
			[600, -1100],
			[-200, -600],
		],
	},
	{
		kind: 'land',
		cover: 'fields',
		area: [
			[300, 4100],
			[1200, 4250],
			[2600, 4550],
			[3700, 4300],
			[3900, 4900],
			[2300, 5200],
			[600, 4900],
		],
	},
];

/** The Valley's roads it does not ride: gravel farm lanes out across its fields, to its farms, over its river and up its hills. */
const VALLEY_LANES: Lane[] = [
	// South off the first straight, out through its fields.
	lane([900, 0], [1000, -500], [800, -1100], [900, -1700]),
	// North off it past the pond, up to the farm under the knoll.
	lane([1700, 0], [1650, 500], [1750, 900], [1800, 1080]),
	// Across the floor inside the loop, over the river on a farm bridge, to the north road.
	lane(
		[500, 0],
		[450, 600],
		[650, 1200],
		[850, 1800],
		[900, 2300],
		[1100, 2900],
		[1300, 3500],
		[1350, 3965],
	),
	// East off the river road's climb, and north-east up the hill.
	lane([4620, 1200], [5200, 1050], [5800, 900], [6400, 800]),
	lane([4600, 3050], [5200, 3300], [5700, 3900], [6400, 4300]),
	// North off the high road, into the woods.
	lane([3300, 4014], [3400, 4500], [3200, 5100], [3300, 5800]),
	// Across the east of the loop to a farm by the bend.
	lane([4900, 2250], [4300, 2400], [3700, 2700], [3300, 3050]),
	// West off the river road, and north-west off the way down.
	lane([-540, 1600], [-1100, 1500], [-1700, 1250], [-2100, 1300]),
	lane([100, 3200], [-300, 3700], [-800, 4300], [-1300, 4900], [-2000, 5300]),
	// South-east off the ramp's road, and south-west by the start.
	lane([4000, 565], [4300, 0], [4500, -600], [4400, -1700]),
	lane([-250, 500], [-800, 300], [-1300, -100], [-2100, -500]),
];

/** A rectangle on a map, in its own metres east and north. */
export type Bounds = {
	west: number;
	east: number;
	south: number;
	north: number;
};

/**
 * A designed land that has a map: its name, the rectangle its picture shows
 * (every road and river that leaves it runs off its edge, none stops short
 * inside it), the loops through it (one picture, every loop on it), and the
 * loop whose world draws the picture: its other roads are every road there.
 * `mpp` is the metres a pixel of the picture covers, `scale` how big the
 * page draws its names, marks and scale bar against Wattalp's, so a smaller
 * land, shown as large, reads alike.
 */
export type Land = {
	id: string;
	name: string;
	bounds: Bounds;
	loops: readonly string[];
	drawnFrom: string;
	mpp: number;
	scale: number;
};

/** WattRoom's lands with a map: Wattalp, and the Valley loop's Rahmental. */
export const LANDS: readonly Land[] = [
	{
		id: 'wattalp',
		name: 'Wattalp',
		bounds: { west: -9600, east: 4500, south: -6600, north: 8000 },
		loops: LOOP_IDS,
		drawnFrom: 'berne',
		mpp: 10,
		scale: 1,
	},
	{
		id: 'rahmental',
		name: 'Rahmental',
		bounds: { west: -1800, east: 6200, south: -1300, north: 5500 },
		loops: ['valley'],
		drawnFrom: 'valley',
		mpp: 5,
		scale: 0.5,
	},
];

/** The land a designed loop runs through, if it has a map. */
export const landOf = (id: string | undefined): Land | undefined =>
	id === undefined ? undefined : LANDS.find((l) => l.loops.includes(id));

/**
 * A road's way through a node's roundabout, from the corner it comes from
 * to the corner it leaves for: straight in on its arm, sharp right onto the ring,
 * anticlockwise round it as traffic on the right goes, and right again off
 * it. The ring is the circle inscribed in the corners laid here, each
 * rounded on the ring's own radius, so every road through a node rides the
 * same circle: the ring, which is drawn as a road of its own (designed.ts
 * ringsOf) with each road's arms joining it.
 */
function through(node: Corner, from: Corner, to: Corner): Corner[] {
	const a = Math.atan2(from.y - node.y, from.x - node.x);
	const b = Math.atan2(to.y - node.y, to.x - node.x);
	const turn =
		(((b - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
	const ring = MAP.rings.find((r) => r.at[0] === node.x && r.at[1] === node.y);
	for (const arm of [a, b])
		if (
			ring &&
			!ring.arms.some((k) => Math.abs(Math.sin((k - arm) / 2)) < 0.03)
		)
			ring.arms.push(arm);
	const sides = Math.ceil(turn / ((60 * Math.PI) / 180));
	const each = turn / sides;
	const out = RING.r / Math.cos(each / 2);
	// An arm's own curve fits in half of the first side: the ring's rounding has the other half.
	const arm = Math.min(
		RING.arm,
		(0.97 * RING.r * Math.tan(each / 2)) / Math.tan(Math.PI / 4 - each / 4),
	);
	const at = (angle: number, radius: number, r: number): Corner => ({
		x: node.x + Math.cos(angle) * radius,
		y: node.y + Math.sin(angle) * radius,
		ele: node.ele,
		r,
	});
	// Level from RING.level out: the heights are smoothed along the road (road/route.ts), and a grade that ran to the stub stood the road a metre over the ring's arm.
	const corners = [at(a, RING.level, 0), at(a, RING.stub, 0)];
	for (let k = 0; k <= sides; k++)
		corners.push(at(a + k * each, out, k === 0 || k === sides ? arm : RING.r));
	corners.push(at(b, RING.stub, 0), at(b, RING.level, 0));
	return corners;
}

/** A loop's corners from its stretches and the roundabouts between them, starting on the first stretch: the last roundabout closes it. */
function round(...parts: (Corner[] | Corner)[]): Corner[] {
	const stretches = parts.filter((p): p is Corner[] => Array.isArray(p));
	const nodes = parts.filter((p): p is Corner => !Array.isArray(p));
	const n = stretches.length;
	const out: Corner[] = [];
	let first: Corner[] = [];
	stretches.forEach((s, i) => {
		const next = stretches[(i + 1) % n];
		const ring = through(nodes[i], s[s.length - 1], next[0]);
		if (i === n - 1) first = ring;
		out.push(...s, ...(i === n - 1 ? ring.slice(0, -1) : ring));
	});
	// It starts on its way out of the last roundabout, on the first stretch's arm.
	return [...first.slice(-2), ...out.slice(0, -1)];
}

/** A stretch ridden the other way. */
const back = (s: Corner[]) => [...s].reverse();

/** The loops, each from the village and back: by the time they take, about 30, 40, 60, 90 and 120 minutes. Each stretch is followed by the node it runs to. */
export const DESIGNS: readonly Designed[] = [
	loop('urnsee', 11151.77, 4340, round(SHORE, HEAD, TERRACE, HUB)),
	loop('aare', 11992.98, 4404, round(GORGE_OUT, WEST, GORGE_HOME, HUB)),
	loop(
		'lac',
		23144,
		4406,
		round(SHORE, HEAD, TERRACE, HUB, GORGE_OUT, WEST, GORGE_HOME, HUB),
	),
	loop('berne', 30628.63, 2101, round(COL, HEAD, TERRACE, HUB)),
	loop(
		'kette',
		50886.45,
		5050,
		round(SHORE, HEAD, KETTE, WEST, back(GORGE_OUT), HUB),
	),
	{
		id: 'valley',
		lengthM: 16036.55,
		shape: { corners: VALLEY, seed: 4248, drawn: true },
		features: VALLEY_LAND,
		spurs: VALLEY_LANES,
	},
];
