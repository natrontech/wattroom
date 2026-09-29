/**
 * Synthetic roads for the pipeline's tests and /dev/road (#3023). Made up on
 * purpose: a real route never enters the repo — a track is somebody's place,
 * and a map's is under its own licence. Each one carries exactly the fault or
 * the feature a test needs, and nothing else.
 */
import type { TrackPoint } from './parse';

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

/** Every fixture /dev/road can ride, by name. */
export const FIXTURES: Record<string, () => TrackPoint[]> = {
	'Bridge and tunnel': bridgeAndTunnel,
	Switchback: switchback,
	'GPS spikes': spiky,
	'21 hairpins': hairpinClimb,
};
