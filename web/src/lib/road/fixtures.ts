/**
 * Synthetic roads for the pipeline's tests and /dev/road (#3023). Made up on
 * purpose: a real route never enters the repo — a track is somebody's place,
 * and a map's is under its own licence. Each one carries exactly the fault or
 * the feature a test needs, and nothing else.
 */
import type { TrackPoint } from './parse';
import type { Road } from './road';

const LAT0 = 46.6;
const LON0 = 7.6;
const M_PER_DEG = (Math.PI / 180) * 6371008.8;
const KX = M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180);

type Move = { straight: number } | { arc: number; turn: number };

/**
 * A road drawn like a turtle: straights and arcs from a heading of east, with
 * a fix every `spacing` metres. `turn` is in degrees, positive to the left.
 */
function drive(
	moves: Move[],
	spacing: number,
): { x: number; y: number; s: number }[] {
	let x = 0;
	let y = 0;
	let heading = 0;
	let s = 0;
	const out = [{ x, y, s }];
	let carry = 0;
	const walk = (dx: number, dy: number) => {
		x += dx;
		y += dy;
		s += Math.hypot(dx, dy);
		carry += Math.hypot(dx, dy);
		if (carry >= spacing - 1e-9) {
			out.push({ x, y, s });
			carry = 0;
		}
	};
	for (const m of moves) {
		if ('straight' in m) {
			for (let d = 0; d < m.straight; d += 0.5)
				walk(Math.cos(heading) * 0.5, Math.sin(heading) * 0.5);
		} else {
			const total = (m.turn * Math.PI) / 180;
			const steps = Math.ceil((Math.abs(total) * m.arc) / 0.5);
			for (let k = 0; k < steps; k++) {
				const a = heading + total / steps / 2;
				const len = (Math.abs(total) * m.arc) / steps;
				walk(Math.cos(a) * len, Math.sin(a) * len);
				heading += total / steps;
			}
		}
	}
	if (carry > 0) out.push({ x, y, s });
	return out;
}

function toPoints(
	xy: { x: number; y: number; s: number }[],
	height: (s: number) => number,
): TrackPoint[] {
	return xy.map((p) => ({
		lat: LAT0 + p.y / M_PER_DEG,
		lon: LON0 + p.x / KX,
		ele: height(p.s),
	}));
}

/** A GPX of the points, as a planner exports one. */
export function toGpx(
	points: TrackPoint[],
	creator = 'WattRoom synthetic fixture',
): string {
	const pts = points
		.map(
			(p) =>
				`<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><ele>${p.ele.toFixed(1)}</ele></trkpt>`,
		)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${creator}" xmlns="http://www.topografix.com/GPX/1/1">
<trk><trkseg>
${pts}
</trkseg></trk>
</gpx>
`;
}

/** The road under bridgeAndTunnel: 2 %, 3 km east. */
export const bridgeAndTunnelRoad = (s: number) => 500 + 0.02 * s;
export const BRIDGE_AT = 1000;
export const TUNNEL_AT = 2000;

/**
 * The height model's two lies about a straight 2 % road: a bridge it drops
 * 25 m into the valley below for 80 m, and a tunnel it lifts 40 m over the
 * hill above for 90 m. The road itself never leaves its 2 %.
 */
export function bridgeAndTunnel(): TrackPoint[] {
	const height = (s: number) =>
		bridgeAndTunnelRoad(s) -
		(Math.abs(s - BRIDGE_AT) <= 40 ? 25 : 0) +
		(Math.abs(s - TUNNEL_AT) <= 45 ? 40 : 0);
	return toPoints(drive([{ straight: 3000 }], 10), height);
}

export const SWITCHBACK_R = 9;

/**
 * A kilometre east, a 9 m-radius hairpin, a kilometre back 18 m north of the
 * way out, climbing 6 %: the tightest turn a real road makes, which a spike
 * rule must leave alone. `side` -1 turns right instead, back 18 m south —
 * through a bearing of due south, where an angle wraps from +180° to −180°.
 */
export function switchback(side: 1 | -1 = 1): TrackPoint[] {
	const height = (s: number) => 800 + 0.06 * s;
	return toPoints(
		drive(
			[
				{ straight: 1000 },
				{ arc: SWITCHBACK_R, turn: 180 * side },
				{ straight: 1000 },
			],
			5,
		),
		height,
	);
}

/**
 * 2.5 km of straight flat road with two GPS faults on it: at 800 m a fix
 * thrown 25 m to the side before the next lands back where the rider was,
 * and at 1600 m a run that overshoots 22 m down the road and walks back —
 * the world's pass loop carries the second — on a road where nothing else
 * turns.
 */
export function spiky(): TrackPoint[] {
	const height = () => 450;
	const xy = drive([{ straight: 2500 }], 8);
	const at = (m: number) => xy.findIndex((p) => p.s >= m);
	const side = at(800);
	const back = xy[side];
	xy.splice(
		side + 1,
		0,
		{ ...back, y: back.y + 25 },
		{ ...back, x: back.x + 0.8 },
	);
	const along = at(1600) + 1;
	const p = xy[along];
	xy.splice(
		along + 1,
		0,
		{ ...p, x: p.x + 30 },
		{ ...p, x: p.x + 15, y: p.y + 0.5 },
	);
	return toPoints(xy, height);
}

export const HAIRPINS = 21;

/**
 * A climb of 21 hairpins, numbered like the famous one and made up like the
 * rest: 22 legs of 300 m stacked up a hillside, each hairpin a 10 m-radius
 * half turn, alternating left and right, 8 % all the way.
 */
export function hairpinClimb(): TrackPoint[] {
	const height = (s: number) => 700 + 0.08 * s;
	const moves: Move[] = [{ straight: 300 }];
	for (let k = 0; k < HAIRPINS; k++)
		moves.push({ arc: 10, turn: k % 2 ? -180 : 180 }, { straight: 300 });
	return toPoints(drive(moves, 8), height);
}

/** How far beside the way out the out-and-back's way back runs, metres. */
export const OUT_AND_BACK_APART = 3.5;
/** The street the out-and-back rides twice, metres. */
export const OUT_AND_BACK_STREET = 2000;

/**
 * Out and back along one street (#4531): 2 km east climbing 2 %, round a
 * lollipop, and 2 km back down the same street, the way back 3.5 m south
 * of the way out, as a second GPS trace of a street lies beside the first.
 * Its height is the street's at each place, ridden either way.
 */
export function outAndBack(): TrackPoint[] {
	const xy = drive(
		[
			{ straight: OUT_AND_BACK_STREET },
			{ arc: 80, turn: -60 },
			{ straight: 4 }, // the jog that sets the way back 3.5 m to the side
			{ arc: 80, turn: 300 },
			{ arc: 80, turn: -60 },
			{ straight: OUT_AND_BACK_STREET },
		],
		10,
	);
	const total = xy[xy.length - 1].s;
	return toPoints(xy, (s) => 500 + 0.02 * Math.min(s, total - s));
}

/** The street a loop from a front door leaves and comes home along, metres. */
export const HOME_STREET = 2200;

/**
 * How far the way home runs beside the way out at each metre of the street
 * (from the door), as a rider's two GPS traces of their own street measured
 * (#4531): 4 m by the door, a 20 m jog across to 15 m off for 330 m, a
 * detour round a block 120 m off, 13 m, then 5–9 m for 850 m, where the
 * way home turns in off the loop. Offsets only, no place.
 */
const HOME_OFFSETS: [street: number, off: number][] = [
	[0, 0],
	[40, 4],
	[400, 4],
	[420, 15],
	[750, 15],
	[800, 120],
	[930, 120],
	[980, 15],
	[1250, 12],
	[1300, 7],
	[1700, 5],
	[2100, 9],
];

/**
 * A loop from a front door (#4531): 2.2 km east along the home street
 * climbing 1 %, a 1.3 km loop, and home along the street again, the way home
 * `offset(m)` metres south of the way out at each metre m of it, and 2.5 m
 * higher, as a second GPS trace of a street lies beside the first.
 * The way home turns in off the loop 30° off the street. Default: the
 * offsets a rider's street measured.
 */
export function homeStreet(
	offset: (m: number) => number = (m) => lerpTable(HOME_OFFSETS, m),
): TrackPoint[] {
	const xy: { x: number; y: number }[] = [];
	for (let m = 0; m < HOME_STREET; m += 10) xy.push({ x: m, y: 0 });
	// The loop: on east, round to the south, and back to turn in off it.
	const corners = [
		{ x: HOME_STREET, y: 0 },
		{ x: HOME_STREET + 400, y: 0 },
		{ x: HOME_STREET + 400, y: -300 },
		{ x: HOME_STREET + 100, y: -offset(HOME_STREET - 100) - 115 },
		{ x: HOME_STREET - 100, y: -offset(HOME_STREET - 100) },
	];
	for (let c = 0; c + 1 < corners.length; c++) {
		const a = corners[c];
		const b = corners[c + 1];
		const len = Math.hypot(b.x - a.x, b.y - a.y);
		for (let d = 0; d < len; d += 10)
			xy.push({
				x: a.x + ((b.x - a.x) * d) / len,
				y: a.y + ((b.y - a.y) * d) / len,
			});
	}
	for (let m = HOME_STREET - 100; m >= 0; m -= 10)
		xy.push({ x: m, y: -offset(m) });
	let s = 0;
	const walked = xy.map((p, i) => {
		if (i > 0) s += Math.hypot(p.x - xy[i - 1].x, p.y - xy[i - 1].y);
		return { ...p, s };
	});
	const out = walked[HOME_STREET / 10].s;
	const home = walked[walked.length - (HOME_STREET - 100) / 10 - 1].s;
	// Climbing 1 % east, and 2.5 m higher home than out, risen round the loop: two traces' heights differ as much.
	const rise = (along: number) =>
		2.5 * Math.min(1, Math.max(0, (along - out) / (home - out)));
	const height = new Map(
		walked.map((p) => [p.s, 500 + 0.01 * p.x + rise(p.s)]),
	);
	return toPoints(walked, (along) => height.get(along)!);
}

/** The value of a table of [at, value] at `m`, in line between its rows. */
function lerpTable(table: [number, number][], m: number): number {
	if (m <= table[0][0]) return table[0][1];
	for (let i = 1; i < table.length; i++) {
		const [a, va] = table[i - 1];
		const [b, vb] = table[i];
		if (m <= b) return va + ((vb - va) * (m - a)) / (b - a);
	}
	return table[table.length - 1][1];
}

/** The winding road's bends, metres of radius: a hairpin, tight, a valley road's, gentle. */
export const WINDING_RADII = [12, 30, 60, 120, 250, 500];

/**
 * A valley road that winds (#4556): each of WINDING_RADII as an S-bend, 70°
 * one way and 70° back, 150 m of straight between, climbing 3 %, with a fix
 * every 8 m (a FIT's second at 29 km/h) and up to a metre of seeded GPS
 * noise, as a recorded ride carries.
 */
export function windingRoad(): TrackPoint[] {
	const moves: Move[] = [{ straight: 300 }];
	for (const r of WINDING_RADII)
		moves.push(
			{ arc: r, turn: r < 20 ? 180 : 70 },
			{ straight: 150 },
			{ arc: r, turn: r < 20 ? -180 : -70 },
			{ straight: 150 },
		);
	moves.push({ straight: 300 });
	let seed = 4556;
	const noise = () => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed / 2147483648 - 0.5;
	};
	const xy = drive(moves, 8).map((p) => ({
		...p,
		x: p.x + noise() * 2,
		y: p.y + noise() * 2,
	}));
	return toPoints(xy, (s) => 600 + 0.03 * s);
}

/** Every fixture /dev/road can ride, by name. */
export const FIXTURES: Record<string, () => TrackPoint[]> = {
	'Bridge and tunnel': bridgeAndTunnel,
	Switchback: switchback,
	'GPS spikes': spiky,
	'21 hairpins': hairpinClimb,
	'Winding road': windingRoad,
};

/**
 * A road drawn as legs of [metres, percent], a sample every 20 m, no turns:
 * the synthetic ride a road's numbers are checked on.
 */
export function legsRoad(...legs: [number, number][]): Road {
	const step = 20;
	const heights = [500];
	for (const [metres, pct] of legs)
		for (let s = 0; s < metres; s += step)
			heights.push(heights[heights.length - 1] + (pct / 100) * step);
	return {
		length: step * (heights.length - 1),
		heights,
		turns: new Array(heights.length - 1).fill(0),
	};
}

const ALPINE_LEGS: [number, number][] = [
	[12_000, 6.5],
	[2_000, 0],
	[13_000, -6],
	[14_000, 0],
	[8_000, 5],
	[8_000, -5],
];

/**
 * An Alpine loop, made up in the shape of the maintainer's reference loop
 * (#3581): a 6.5 % pass straight from km 0, 2 km over the top, 13 km down,
 * 14 km of valley, then a 5 % climb and its descent back to the start. 57 km.
 */
export const alpineLoop = () => legsRoad(...ALPINE_LEGS);

/** The same loop as the fixes a GPX carries, one every 10 m, ridden due east. */
export function alpineTrack(): TrackPoint[] {
	const length = ALPINE_LEGS.reduce((m, [metres]) => m + metres, 0);
	const height = (s: number) => {
		let h = 500;
		for (const [metres, pct] of ALPINE_LEGS) {
			h += (pct / 100) * Math.min(Math.max(s, 0), metres);
			s -= metres;
		}
		return h;
	};
	return toPoints(drive([{ straight: length }], 10), height);
}
