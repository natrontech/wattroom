import type { TrainerSample } from './trainer';
import type { SensorKind, SensorReading } from './sensor';

/**
 * Which source owns each number when several disagree.
 *
 * The rules are TrainerRoad's, adopted as-is per docs/RESEARCH.md §11 rather than
 * invented: a paired power meter always wins power over the trainer, and cadence
 * ranks dedicated sensor > power-meter crank > trainer estimate. The trainer ranks
 * last on cadence because Kickr cadence is firmware-estimated rather than measured,
 * and demonstrably drops out on sprint-to-easy transitions — which is exactly when
 * the spiral guard is reading it.
 *
 * Heart rate follows the same shape (#44): a strap paired directly to us beats the
 * same strap relayed through the trainer.
 */
export const ARBITRATION = {
	/**
	 * A source that has gone quiet stops winning. Without this a strap that goes out
	 * of range holds its last reading on screen forever, which is worse than showing
	 * nothing — the rider believes a stale number. Tune in alpha.
	 */
	staleMs: 5000,
} as const;

export type MetricSource = SensorKind | 'trainer';

export interface MetricInputs {
	trainer?: TrainerSample;
	/** Latest reading from each connected sensor, by kind. */
	sensors: Partial<Record<SensorKind, SensorReading>>;
}

export interface Metrics {
	watts: number;
	cadence: number;
	heartRate?: number;
	/** Where each number came from — the pairing screen shows this, so a rider can
	 *  see that their meter is winning rather than having to trust it. */
	from: {
		watts?: MetricSource;
		cadence?: MetricSource;
		heartRate?: MetricSource;
	};
}

function fresh<T extends { at: number }>(
	value: T | undefined,
	now: number,
): T | undefined {
	if (!value) return undefined;
	return now - value.at <= ARBITRATION.staleMs ? value : undefined;
}

/**
 * Merge everything currently arriving into the one set of numbers the ride uses.
 * Pure: the ride owns the inputs, this owns only the ranking.
 */
export function arbitrate(
	{ trainer, sensors }: MetricInputs,
	now: number = Date.now(),
): Metrics {
	const meter = fresh(sensors['power-meter'], now);
	const cadenceSensor = fresh(sensors['cadence'], now);
	const strap = fresh(sensors['heart-rate'], now);
	const bike = fresh(trainer, now);

	const out: Metrics = { watts: 0, cadence: 0, from: {} };

	// Power: meter over trainer.
	if (meter?.watts !== undefined) {
		out.watts = meter.watts;
		out.from.watts = 'power-meter';
	} else if (bike) {
		out.watts = bike.watts;
		out.from.watts = 'trainer';
	}

	// Cadence: dedicated sensor, then the meter's crank, then the trainer's guess.
	// A source reporting 0 still counts as reporting — that is the rider stopped,
	// not a missing source, and auto-pause depends on telling those apart.
	if (cadenceSensor?.cadence !== undefined) {
		out.cadence = cadenceSensor.cadence;
		out.from.cadence = 'cadence';
	} else if (meter?.cadence !== undefined) {
		out.cadence = meter.cadence;
		out.from.cadence = 'power-meter';
	} else if (bike) {
		out.cadence = bike.cadence;
		out.from.cadence = 'trainer';
	}

	// Heart rate: our strap over the trainer's relay. Stays undefined when neither
	// exists — no strap is normal, and 0 bpm would be a lie.
	if (strap?.heartRate !== undefined) {
		out.heartRate = strap.heartRate;
		out.from.heartRate = 'heart-rate';
	} else if (bike?.heartRate !== undefined) {
		out.heartRate = bike.heartRate;
		out.from.heartRate = 'trainer';
	}

	return out;
}
