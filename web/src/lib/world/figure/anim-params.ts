/**
 * The animator's numbers (#3071). The ones marked SPEC are docs/SPEC.md
 * "Rider animation" (#3066); the rest are the rider studio's, proposals for
 * that table.
 */

export const DEG = Math.PI / 180;
export const fin = (x: unknown, d: number) =>
	typeof x === 'number' && Number.isFinite(x) ? x : d;

// prettier-ignore
export const ANIM = {
	stopped: { cadence: 5, power: 20 }, // SPEC (Ride guards)
	maxRpm: 130,
	sprint: { enterR: 1.6, enterArmedR: 1.2, exitR: 1.2, exitArmedR: 1.0, minCad: 50, dwell: 2 }, // SPEC
	climb: { grade: 5, cadBelow: 72, r: 0.8, hold: 2, exitCad: 78, exitGrade: 3, exitR: 0.65, dwell: 3 }, // SPEC
	tuck: { kmh: 50, grade: -4, exitKmh: 42, dwell: 1.5, after: 0.4 }, // SPEC, and 0.4 s of coasting first
	stretch: { every: [180, 360], lasts: [8, 15] }, // SPEC
	drops: { kmh: 45, r: 1.2, exitKmh: 40, exitR: 1.05 }, // SPEC entry
	tops: { grade: 4, r: 0.55, exitGrade: 3, exitR: 0.65 }, // SPEC entry
	halfLife: { cadence: 0.3, cadenceRemote: 0.5, stand: 0.25, lean: 0.3, steer: 0.15, elbow: 0.25, gaze: 0.3, sway: 0.3, rock: 0.4, tuck: 0.3, pitch: 0.25, look: 0.25 }, // SPEC for the first five
	swayDeg: { seated: 0.6, climb: 4, sprint: 9 }, // SPEC
	rockDeg: { seated: 1.8, stand: 1.0 },
	/** Crank angle past top dead centre, degrees, the lead leg rises in, and sits down in. */
	standWindow: [20, 60], sitWindow: [160, 200],
	gripDwell: 3, gripMove: 0.3, gripStagger: 0.12,
	/** Every posture holds at least this long, and pedalling must start or stop for this long, so data chattering at a threshold never flickers. */
	postureFloor: 1, pedalHold: 0.3,
	elbow: { hoods: 20, drops: 28, tops: 16, extensions: 20, sprint: 55, climb: 36, coast: 18, tuck: 80, stopped: 16 },
	gaze: { seated: -8, sprint: -15, climb: -10, coast: -5, tuck: -18, stopped: -3 },
	/** SPEC: coasting cranks reach a level position within 1.2 s, or stop softly where they are. */
	settleWithin: 1.2,
} as const;

export type Posture =
	'stopped' | 'coast' | 'tuck' | 'seated' | 'sprint' | 'climb' | 'stretch';

export type Spring = { x: number; v: number };
export const sp0 = (x = 0): Spring => ({ x, v: 0 });

/** A critically damped spring toward `goal`, `hl` its half-life in seconds. */
export function spring(s: Spring, goal: number, hl: number, dt: number): void {
	const y = (2 * Math.LN2) / Math.max(hl, 1e-3);
	const j0 = s.x - goal;
	const j1 = s.v + j0 * y;
	const e = Math.exp(-y * dt);
	s.x = e * (j0 + j1 * dt) + goal;
	s.v = e * (s.v - j1 * y * dt);
}

/** mulberry32: a seeded stream, so two riders never look around in step and a replay looks the same. */
export function mulberry(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
