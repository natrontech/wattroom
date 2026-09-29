// The standard road-cycling power model (Martin et al. 1998), integrated as
// kinetic energy so a rider carries speed over a crest and gains it downhill:
//   m·v·dv/dt = η·P − (m·g·sinθ + Crr·m·g·cosθ + ½·ρ·CdA·(v+w)²)·v
// ponytail: defaults for a road bike on the hoods; per-rider CdA/Crr would be
// a setting nobody changes (95 % rule) until a race needs fairness classes.

export type Body = {
	mass: number; // rider + bike, kg
	cda?: number; // m²
	crr?: number;
	eta?: number; // drivetrain efficiency
};

const G = 9.80665;
const RHO = 1.225;

export function resistiveForce(
	v: number,
	gradePct: number,
	b: Body,
	windMs = 0,
): number {
	const th = Math.atan(gradePct / 100);
	const cda = b.cda ?? 0.32;
	const crr = b.crr ?? 0.004;
	const air = v + windMs; // headwind positive
	return (
		b.mass * G * Math.sin(th) +
		crr * b.mass * G * Math.cos(th) +
		0.5 * RHO * cda * air * Math.abs(air)
	);
}

// One integration step. dt in seconds, v in m/s; never negative (no rolling back).
export function step(
	v: number,
	watts: number,
	gradePct: number,
	b: Body,
	dt: number,
	windMs = 0,
): number {
	const eta = b.eta ?? 0.97;
	const vv = Math.max(v, 0.5); // keeps P/v finite from a standstill
	const accel =
		(eta * watts) / (b.mass * vv) -
		resistiveForce(v, gradePct, b, windMs) / b.mass;
	return Math.max(0, v + accel * dt);
}

// Steady-state speed for a power on a grade: bisection on the balance.
export function steadySpeed(
	watts: number,
	gradePct: number,
	b: Body,
	windMs = 0,
): number {
	const eta = b.eta ?? 0.97;
	let lo = 0;
	let hi = 40;
	for (let k = 0; k < 60; k++) {
		const mid = (lo + hi) / 2;
		if (eta * watts > resistiveForce(mid, gradePct, b, windMs) * mid) lo = mid;
		else hi = mid;
	}
	return lo;
}

// What the trainer is told. Zwift's default "trainer difficulty" halves the
// grade so a 12 % ramp does not stall a rider on a direct-drive; descents
// are sent flat because a trainer cannot push the pedals.
// ponytail: fixed 50 %, a knob when riders ask for it.
export function trainerGrade(routeGrade: number, difficulty = 0.5): number {
	return Math.max(0, routeGrade * difficulty);
}

// The reference rider every schedule is timed against: 2.5 W/kg at 75 kg,
// on an 8 kg bike.
export const REFERENCE = { watts: 187.5, body: { mass: 83 } } as const;
