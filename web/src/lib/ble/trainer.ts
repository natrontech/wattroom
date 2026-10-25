import {
	PaceAirDensity,
	PaceCrr,
	PaceDefaultCdA,
	PaceGravity,
} from '$lib/protocol';

export type TrainerStatus = 'disconnected' | 'connecting' | 'connected';

export type ControlMode = 'erg' | 'sim';

export interface TrainerSample {
	watts: number;
	/** rpm; 0 while coasting/stopped (drives auto-pause) */
	cadence: number;
	/**
	 * bpm, when a strap is bonded to the trainer and it relays HR in its data
	 * stream (#44). Absent is the normal case and is not an error: most riders
	 * have no strap, and those who do may have paired it to us directly instead —
	 * a directly-paired strap wins, see arbitrate.ts.
	 */
	heartRate?: number;
	/**
	 * When `heartRate` was last reported, ms epoch; `at` when absent. A unit
	 * that splits Indoor Bike Data carries heart rate in one frame and power in
	 * the next, and one that stops relaying it keeps its last value, so the
	 * sample's own time says nothing about how old the heart rate is (#3517).
	 */
	heartRateAt?: number;
	/**
	 * The trainer's own flywheel speed, m/s, from Indoor Bike Data's
	 * instantaneous speed. The virtual drivetrain is its only reader
	 * (ADR-0084): the dot, timing and the bike computer never read it.
	 */
	speedMps?: number;
	/** ms epoch */
	at: number;
}

/**
 * What a SIM write carries (FTMS op 0x11 / WCPS op 0x46). An absent field is
 * SIM_DEFAULTS' value, so a grade alone sends the default road.
 */
export interface SimParams {
	/** Signed grade, percent. */
	gradePct: number;
	/** Rolling resistance coefficient. */
	crr?: number;
	/** Wind resistance coefficient, kg/m. */
	cw?: number;
	/** Head wind, m/s; negative is a tail wind. */
	windMps?: number;
}

/**
 * The road a SIM write describes unless it says otherwise: the pace model's
 * own (docs/SPEC.md "Route rides"), so the trainer resists with the air the
 * dot rides through. FTMS gives Cw in kg/m and no formula; its meaning is
 * ANT+ FE-C's, Cw = ρ·CdA with an aero force of ½·Cw·(v + wind)² (RESEARCH.md
 * §11, #3351). So Cw is ρ·CdA, 0.39 kg/m on the wire, and never ½·ρ·CdA.
 */
export const SIM_DEFAULTS = {
	crr: PaceCrr,
	cw: PaceAirDensity * PaceDefaultCdA,
	windMps: 0,
} as const;

/**
 * The force a trainer resists with at flywheel speed v, newtons, for the road
 * it was sent and the rider and bike it assumes: FE-C's model, which FTMS's
 * fields carry. Negative on a descent steep enough that a brake-only trainer
 * has nothing left to brake.
 */
export function trainerForce(
	road: Required<SimParams>,
	massKg: number,
	v: number,
): number {
	const theta = Math.atan(road.gradePct / 100);
	const air = v + road.windMps;
	return (
		massKg * PaceGravity * (Math.sin(theta) + road.crr * Math.cos(theta)) +
		0.5 * road.cw * air * Math.abs(air)
	);
}

/** Every field of a SIM write, the absent ones at their defaults. */
export function resolveSim(road: SimParams): Required<SimParams> {
	return {
		gradePct: road.gradePct,
		crr: road.crr ?? SIM_DEFAULTS.crr,
		cw: road.cw ?? SIM_DEFAULTS.cw,
		windMps: road.windMps ?? SIM_DEFAULTS.windMps,
	};
}

/**
 * The only boundary to trainer hardware. Implementations: SimulatedTrainer (dev/CI),
 * FtmsTrainer (Kickr Core+). WcpsTrainer (pre-FTMS Kickr v2) is planned but not
 * built — backlog, see #4. Never call navigator.bluetooth outside implementations
 * of this interface.
 */
export interface Trainer {
	readonly name: string;
	readonly status: TrainerStatus;
	readonly mode: ControlMode;
	/**
	 * Data frames seen, and how many carried power (#520, #1849). A driver
	 * that counts lets a unit that reports but never sends watts be told from
	 * one that is silent — the two want different advice. Optional: the
	 * simulator does not count, and absent reads as "cannot tell".
	 */
	readonly frames?: number;
	readonly poweredFrames?: number;
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	/** ERG: trainer holds these watts. Implementations serialize writes behind device acks. */
	setTargetPower(watts: number): Promise<void>;
	/** Slope mode: the road to ride (FTMS op 0x11 / WCPS op 0x46). Switches mode to 'sim'. */
	setSimulation(road: SimParams): Promise<void>;
	/** FTMS op 0x12, for the Gears probe alone (#3331); absent where unsupported. */
	setWheelCircumference?(mm: number): Promise<void>;
	/** ~1 Hz while connected. Returns unsubscribe. */
	onSample(cb: (s: TrainerSample) => void): () => void;
	onStatus(cb: (s: TrainerStatus) => void): () => void;
}
