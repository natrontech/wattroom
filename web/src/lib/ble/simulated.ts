import {
	BikeKg,
	PaceDrivetrainEfficiency,
	PaceGravity,
	PaceSubsteps,
	ReferenceRiderKg,
} from '$lib/protocol';
import { nextSpeed } from '$lib/road/pace';
import {
	resolveSim,
	type ControlMode,
	type SimParams,
	type Trainer,
	type TrainerSample,
	type TrainerStatus,
} from './trainer';

/** One control write, as the trainer took it — SIM with every field resolved. */
export type ControlWrite =
	{ op: 'erg'; watts: number } | ({ op: 'sim' } & Required<SimParams>);

/**
 * The real gear the simulated rider pushes (#3050), and the wheel it drives:
 * the flywheel's speed is cadence × chainring / cog × WHEEL_METRES. The
 * circumference is the one ADR-0084's real-ratio detection divides by.
 */
export interface RealRatio {
	chainring: number;
	cog: number;
}
const DEFAULT_RATIO: RealRatio = { chainring: 34, cog: 14 };
const WHEEL_METRES = 2.096;

export interface SimulatedTrainerOptions {
	/** The watts a rider holds in SIM, whatever the road (the default rider). */
	baseWatts?: number;
	/**
	 * A rider who holds this cadence in SIM instead: the road and its gear
	 * decide the watts, so a virtual shift changes them (#3050).
	 */
	cadence?: number;
	/** The real gear on the bike; 34×14 unless a test says otherwise. */
	ratio?: RealRatio;
	/** Rider and bike, kg, for the trainer's own road; the reference rider by default. */
	massKg?: number;
	/** power lag time constant, seconds */
	tauSeconds?: number;
	/** peak power noise, watts */
	noiseWatts?: number;
	/** sample interval */
	tickMs?: number;
	/** injectable randomness for deterministic tests, [0,1) */
	rng?: () => number;
	now?: () => number;
	/**
	 * Replay a captured series instead of generating (#54): deterministic, so
	 * an accepted feedback report converts into a regression test. The series
	 * plays once at tick rate; past its end the trainer reports nothing, like
	 * a rider who stopped.
	 */
	replay?: { watts: number; cadence: number; hr?: number }[];
}

/**
 * A fake trainer with just enough physics to exercise the app: power lags toward
 * target (first-order), noise on top, dropouts injectable.
 *
 * In ERG it holds the target and the rider's cadence follows the power. In SIM
 * it rides the road it was last sent — all four SimParams fields, as a trainer
 * resists: m·g·(sinθ + Crr·cosθ) + Cw·(v + wind)² — on the pace model's own
 * integration, and reports the flywheel's speed through a real gear (#3050).
 * A rider holds either power (the road decides speed and cadence) or cadence
 * (the road and the gear decide the watts).
 */
export class SimulatedTrainer implements Trainer {
	readonly name = 'Simulated Trainer';

	#status: TrainerStatus = 'disconnected';
	#mode: ControlMode = 'erg';
	#targetWatts = 100;
	#road = resolveSim({ gradePct: 0 });
	#watts = 0;
	/** The flywheel's speed, m/s. */
	#speed = 0;
	#dropped = false;

	#sampleCbs = new Set<(s: TrainerSample) => void>();
	#statusCbs = new Set<(s: TrainerStatus) => void>();
	#timer: ReturnType<typeof setInterval> | undefined;

	#baseWatts: number;
	#tau: number;
	#noise: number;
	#tickMs: number;
	#rng: () => number;
	#now: () => number;
	#replay?: { watts: number; cadence: number; hr?: number }[];
	#replayAt = 0;
	#cadence?: number;
	#metresPerRev: number;
	#mass: number;

	constructor(opts: SimulatedTrainerOptions = {}) {
		this.#baseWatts = opts.baseWatts ?? 180;
		this.#tau = opts.tauSeconds ?? 2;
		this.#noise = opts.noiseWatts ?? 5;
		this.#tickMs = opts.tickMs ?? 1000;
		this.#rng = opts.rng ?? Math.random;
		this.#now = opts.now ?? Date.now;
		this.#replay = opts.replay;
		this.#cadence = opts.cadence;
		const ratio = opts.ratio ?? DEFAULT_RATIO;
		this.#metresPerRev = (ratio.chainring / ratio.cog) * WHEEL_METRES;
		this.#mass = opts.massKg ?? ReferenceRiderKg + BikeKg;
	}

	/** The watts a power-holding rider puts out in SIM; a sprint raises it. */
	get effort(): number {
		return this.#baseWatts;
	}
	set effort(watts: number) {
		this.#baseWatts = watts;
	}

	get status() {
		return this.#status;
	}

	get mode() {
		return this.#mode;
	}

	/** Every control write in order, so a test can count what reached the trainer. */
	readonly writes: ControlWrite[] = [];
	/** The road the last SIM write described, defaults resolved. */
	get road(): Required<SimParams> {
		return this.#road;
	}

	async connect(): Promise<void> {
		if (this.#status === 'connected') return;
		this.#setStatus('connecting');
		this.#setStatus('connected');
		this.#timer = setInterval(() => this.#tick(), this.#tickMs);
	}

	async disconnect(): Promise<void> {
		clearInterval(this.#timer);
		this.#timer = undefined;
		this.#watts = 0;
		this.#setStatus('disconnected');
	}

	async setTargetPower(watts: number): Promise<void> {
		this.#assertConnected();
		this.#mode = 'erg';
		this.#targetWatts = Math.max(0, watts);
		this.writes.push({ op: 'erg', watts });
	}

	async setSimulation(road: SimParams): Promise<void> {
		this.#assertConnected();
		this.#mode = 'sim';
		this.#road = resolveSim(road);
		this.writes.push({ op: 'sim', ...this.#road });
	}

	onSample(cb: (s: TrainerSample) => void): () => void {
		this.#sampleCbs.add(cb);
		return () => this.#sampleCbs.delete(cb);
	}

	onStatus(cb: (s: TrainerStatus) => void): () => void {
		this.#statusCbs.add(cb);
		return () => this.#statusCbs.delete(cb);
	}

	/** Drop the connection for a while — samples stop, status shows reconnecting, then recovers. */
	simulateDropout(ms: number): void {
		if (this.#dropped || this.#status !== 'connected') return;
		this.#dropped = true;
		this.#setStatus('connecting');
		setTimeout(() => {
			this.#dropped = false;
			this.#setStatus('connected');
		}, ms);
	}

	#tick(): void {
		if (this.#dropped) return;
		if (this.#replay) {
			const sample = this.#replay[this.#replayAt++];
			if (!sample) return; // series over: silence, like a stopped rider
			const heartRate = sample.hr && sample.hr > 0 ? sample.hr : undefined;
			for (const cb of this.#sampleCbs) {
				cb({
					watts: sample.watts,
					cadence: sample.cadence,
					heartRate,
					at: this.#now(),
				});
			}
			return;
		}
		const sim = this.#mode === 'sim';
		const holdsCadence = sim && this.#cadence !== undefined;
		const pedalled = holdsCadence
			? (this.#cadence! / 60) * this.#metresPerRev
			: this.#speed;
		const target = !sim
			? this.#targetWatts
			: holdsCadence
				? Math.max(
						0,
						(this.#force(pedalled) * pedalled) / PaceDrivetrainEfficiency,
					)
				: this.#baseWatts;
		const seconds = this.#tickMs / 1000;
		const alpha = 1 - Math.exp(-seconds / this.#tau);
		this.#watts += (target - this.#watts) * alpha;
		const watts = Math.max(
			0,
			Math.round(this.#watts + (this.#rng() * 2 - 1) * this.#noise),
		);
		let cadence: number;
		if (!sim) {
			// The rider's legs follow ERG's watts, and the flywheel their legs.
			cadence =
				watts < 20
					? 0
					: Math.round(
							clamp(
								85 + (watts - 200) / 15 + (this.#rng() * 2 - 1) * 2,
								60,
								110,
							),
						);
			this.#speed = (cadence / 60) * this.#metresPerRev;
		} else if (holdsCadence) {
			cadence = watts < 20 ? 0 : this.#cadence!;
			this.#speed = pedalled;
		} else {
			// The road decides the speed; the gear turns it into cadence.
			const dt = seconds / PaceSubsteps;
			for (let i = 0; i < PaceSubsteps; i++)
				this.#speed = nextSpeed(
					this.#speed,
					this.#mass,
					PaceDrivetrainEfficiency * this.#watts,
					this.#force(this.#speed),
					dt,
				);
			cadence =
				watts < 20 ? 0 : Math.round((this.#speed / this.#metresPerRev) * 60);
		}
		const sample: TrainerSample = {
			watts,
			cadence,
			speedMps: this.#speed,
			at: this.#now(),
		};
		for (const cb of this.#sampleCbs) cb(sample);
	}

	/** The trainer's road at speed v, newtons: FTMS's model, not the dot's. */
	#force(v: number): number {
		const { gradePct, crr, cw, windMps } = this.#road;
		const theta = Math.atan(gradePct / 100);
		const air = v + windMps;
		return (
			this.#mass * PaceGravity * (Math.sin(theta) + crr * Math.cos(theta)) +
			cw * air * Math.abs(air)
		);
	}

	#setStatus(s: TrainerStatus): void {
		this.#status = s;
		for (const cb of this.#statusCbs) cb(s);
	}

	#assertConnected(): void {
		if (this.#status !== 'connected') throw new Error('trainer not connected');
	}
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}
