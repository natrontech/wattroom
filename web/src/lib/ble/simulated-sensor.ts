import type { Sensor, SensorKind, SensorReading, SensorStatus } from './sensor';

export interface SimulatedSensorOptions {
	/** Resting rate the strap drifts up from, bpm. */
	restingBpm?: number;
	/** Where effort takes it, bpm. */
	workingBpm?: number;
	/** How slowly heart rate chases effort — the whole point of simulating it. */
	tauSeconds?: number;
	watts?: number;
	cadence?: number;
	tickMs?: number;
	/** Injectable randomness for deterministic tests, [0,1). */
	rng?: () => number;
	now?: () => number;
}

/**
 * A fake sensor, for the same reason `SimulatedTrainer` exists: the dashboard, the
 * arbitration and the stats have to be developable without a strap on your chest,
 * and CI has no chest at all (#11).
 *
 * Heart rate lags rather than tracking power, because lag is the property that makes
 * HR displays look wrong when you get it wrong — a number that snaps to effort reads
 * as fake immediately, and any smoothing bug hides behind an instant response.
 *
 * ponytail: no HRV. RR intervals are parsed off real straps but nothing consumes
 * them yet; simulate them when something does.
 */
export function createSimulatedSensor(
	kind: SensorKind,
	opts: SimulatedSensorOptions = {},
): Sensor {
	const resting = opts.restingBpm ?? 65;
	const working = opts.workingBpm ?? 155;
	const tau = opts.tauSeconds ?? 20;
	const watts = opts.watts ?? 200;
	const cadence = opts.cadence ?? 88;
	const tickMs = opts.tickMs ?? 1000;
	const rng = opts.rng ?? Math.random;
	const now = opts.now ?? Date.now;

	let status: SensorStatus = 'disconnected';
	let bpm = resting;
	let timer: ReturnType<typeof setInterval> | undefined;
	const readingCbs = new Set<(r: SensorReading) => void>();
	const statusCbs = new Set<(s: SensorStatus) => void>();

	function setStatus(next: SensorStatus) {
		status = next;
		for (const cb of statusCbs) cb(next);
	}

	function tick() {
		const reading: SensorReading = { at: now() };
		if (kind === 'heart-rate') {
			// First-order lag toward the working rate, plus a beat of jitter.
			bpm += ((working - bpm) * tickMs) / 1000 / tau;
			reading.heartRate = Math.round(bpm + (rng() - 0.5) * 2);
		}
		if (kind === 'power-meter') {
			reading.watts = Math.round(watts + (rng() - 0.5) * 10);
			reading.cadence = Math.round(cadence + (rng() - 0.5) * 4);
		}
		if (kind === 'cadence') {
			reading.cadence = Math.round(cadence + (rng() - 0.5) * 4);
		}
		for (const cb of readingCbs) cb(reading);
	}

	return {
		kind,
		name: `Simulated ${kind.replace('-', ' ')}`,
		get status() {
			return status;
		},
		async connect() {
			setStatus('connecting');
			bpm = resting;
			timer = setInterval(tick, tickMs);
			setStatus('connected');
		},
		async disconnect() {
			clearInterval(timer);
			timer = undefined;
			setStatus('disconnected');
		},
		onReading(cb) {
			readingCbs.add(cb);
			return () => readingCbs.delete(cb);
		},
		onStatus(cb) {
			statusCbs.add(cb);
			return () => statusCbs.delete(cb);
		},
	};
}
