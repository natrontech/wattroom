// A made-up pass loop, so the repo carries no real-world track (a GPX from
// OpenStreetMap is ODbL, and national height models carry their own terms).
// Deterministic: a closed polygon with filleted corners, heights pinned at
// every corner, a little seeded GPS noise — plus one duplicate fix and one
// out-and-back spike, the two faults route.ts exists to remove.
//
// The shape: ~6 km of flat valley, a steady approach, six legs up a hillside
// joined by five hairpins, a short summit ridge, a long winding descent and the valley
// again — about 30 km and 600 m up.
import { prng } from './rand';
import type { GpxPoint } from './gpx';

export const SYNTHETIC_NAME = 'Synthetic pass loop';

type Corner = { x: number; y: number; ele: number; r: number }; // metres; y is north

const HAIRPIN_R = 14;
const CORNERS: Corner[] = [
	{ x: 0, y: 0, ele: 600, r: 150 },
	{ x: 6000, y: 0, ele: 610, r: 200 },
	{ x: 7500, y: 1500, ele: 690, r: 150 },
	{ x: 7500, y: 3000, ele: 780, r: 40 },
	// the switchbacks: 800 m legs at 12° to the contour, 7.5 %
	{ x: 6717.5, y: 3166.3, ele: 840, r: HAIRPIN_R },
	{ x: 7500, y: 3332.6, ele: 900, r: HAIRPIN_R },
	{ x: 6717.5, y: 3498.9, ele: 960, r: HAIRPIN_R },
	{ x: 7500, y: 3665.2, ele: 1020, r: HAIRPIN_R },
	{ x: 6717.5, y: 3831.5, ele: 1080, r: HAIRPIN_R },
	{ x: 7500, y: 3997.8, ele: 1140, r: 40 },
	{ x: 8200, y: 4500, ele: 1175, r: 80 },
	{ x: 8000, y: 5300, ele: 1185, r: 120 },
	// the descent, winding west and down
	{ x: 6000, y: 5800, ele: 1030, r: 200 },
	{ x: 4500, y: 5300, ele: 910, r: 250 },
	{ x: 3000, y: 5800, ele: 800, r: 250 },
	{ x: 1500, y: 5000, ele: 700, r: 200 },
	{ x: -500, y: 4000, ele: 630, r: 250 },
	{ x: -800, y: 2400, ele: 608, r: 300 },
];
const SPACING = 8; // metres between track points, like a GPS logging every second or two
const LAT0 = 46.6;
const LON0 = 7.6;
const M_PER_DEG = (Math.PI / 180) * 6371008.8;

type Pt = { x: number; y: number };
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (a: Pt): Pt => {
	const l = Math.hypot(a.x, a.y);
	return { x: a.x / l, y: a.y / l };
};

// The centreline, every SPACING metres, starting mid-valley, with the
// distance along it at which each corner's height applies.
function centreline() {
	const n = CORNERS.length;
	const arcs = CORNERS.map((v, i) => {
		const d1 = unit(sub(v, CORNERS[(i + n - 1) % n]));
		const d2 = unit(sub(CORNERS[(i + 1) % n], v));
		const phi = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)));
		const t = v.r * Math.tan(phi / 2);
		const turn = Math.sign(d1.x * d2.y - d1.y * d2.x); // +1 turns left
		const a = { x: v.x - d1.x * t, y: v.y - d1.y * t };
		const b = { x: v.x + d2.x * t, y: v.y + d2.y * t };
		const centre = { x: a.x - d1.y * v.r * turn, y: a.y + d1.x * v.r * turn };
		return { a, b, centre, phi, turn, r: v.r };
	});
	const out: Pt[] = [];
	const knots: number[] = []; // distance of each corner's arc midpoint
	let s = 0;
	let carry = 0; // distance since the last emitted point
	let last: Pt = {
		x: (CORNERS[0].x + CORNERS[1].x) / 2,
		y: (CORNERS[0].y + CORNERS[1].y) / 2,
	};
	out.push(last);
	const walk = (p: Pt) => {
		const step = Math.hypot(p.x - last.x, p.y - last.y);
		s += step;
		carry += step;
		if (carry >= SPACING) {
			out.push(p);
			carry = 0;
		}
		last = p;
	};
	const straight = (to: Pt) => {
		const from = last;
		const len = Math.hypot(to.x - from.x, to.y - from.y);
		const k = Math.ceil(len);
		for (let j = 1; j <= k; j++)
			walk({
				x: from.x + ((to.x - from.x) * j) / k,
				y: from.y + ((to.y - from.y) * j) / k,
			});
	};
	for (let k = 1; k <= n; k++) {
		const arc = arcs[k % n];
		straight(arc.a);
		const a0 = Math.atan2(arc.a.y - arc.centre.y, arc.a.x - arc.centre.x);
		const steps = Math.max(2, Math.ceil(arc.phi * arc.r));
		for (let j = 1; j <= steps; j++) {
			const a = a0 + (arc.phi * arc.turn * j) / steps;
			walk({
				x: arc.centre.x + Math.cos(a) * arc.r,
				y: arc.centre.y + Math.sin(a) * arc.r,
			});
			if (j === Math.round(steps / 2)) knots[k % n] = s;
		}
	}
	straight(out[0]);
	out.push(out[0]); // a loop ends where it began
	return { points: out, knots, length: s };
}

// Heights linear in distance between corners, wrapping at the start.
function heightAlong(knots: number[], length: number) {
	const order = CORNERS.map((c, i) => ({ s: knots[i], ele: c.ele })).sort(
		(p, q) => p.s - q.s,
	);
	const first = order[0];
	const lastK = order[order.length - 1];
	const all = [
		{ s: lastK.s - length, ele: lastK.ele },
		...order,
		{ s: first.s + length, ele: first.ele },
	];
	return (s: number) => {
		let j = 0;
		while (j < all.length - 2 && all[j + 1].s < s) j++;
		const t = (s - all[j].s) / (all[j + 1].s - all[j].s);
		return all[j].ele + (all[j + 1].ele - all[j].ele) * t;
	};
}

export function syntheticPoints(): GpxPoint[] {
	const { points, knots, length } = centreline();
	const ele = heightAlong(knots, length);
	const noise = prng(3021);
	const track: { x: number; y: number; ele: number }[] = [];
	let s = 0;
	points.forEach((p, i) => {
		if (i > 0) s += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
		const last = i === points.length - 1;
		track.push({
			x: p.x + (last ? 0 : (noise() - 0.5) * 1.6),
			y: p.y + (last ? 0 : (noise() - 0.5) * 1.6),
			ele: ele(Math.min(s, length)) + (noise() - 0.5) * 1.2,
		});
	});
	// A fix logged twice, and a 15 m out-and-back — both on the valley floor.
	track.splice(40, 0, { ...track[40] });
	const at = track[80];
	track.splice(
		81,
		0,
		{ x: at.x + 30, y: at.y, ele: at.ele },
		{ x: at.x + 15, y: at.y + 0.5, ele: at.ele },
	);
	return track.map((p) => ({
		lat: LAT0 + p.y / M_PER_DEG,
		lon: LON0 + p.x / (M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)),
		ele: p.ele,
	}));
}

export function syntheticGpx(): string {
	const pts = syntheticPoints()
		.map(
			(p) =>
				`<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><ele>${p.ele.toFixed(1)}</ele></trkpt>`,
		)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WattRoom synthetic fixture" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${SYNTHETIC_NAME}</name><trkseg>
${pts}
</trkseg></trk>
</gpx>
`;
}
