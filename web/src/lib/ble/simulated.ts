import type {
	ControlMode,
	Trainer,
	TrainerSample,
	TrainerStatus,
} from './trainer';

export interface SimulatedTrainerOptions {
	/** rider's steady effort in sim mode, watts */
	baseWatts?: number;
	/** power lag time constant, seconds */
	tauSeconds?: number;
	/** peak power noise, watts */
	noiseWatts?: number;
	/** sample interval */
	tickMs?: number;
	/** injectable randomness for deterministic tests, [0,1) */
	rng?: () => number;
	now?: () => number;
}

/**
 * A fake trainer with just enough physics to exercise the app: power lags toward
 * target (first-order), noise on top, cadence follows power, dropouts injectable.
 * ponytail: no flywheel/gearing model — add if workout-engine testing ever needs it.
 */
export class SimulatedTrainer implements Trainer {
	readonly name = 'Simulated Trainer';

	#status: TrainerStatus = 'disconnected';
	#mode: ControlMode = 'erg';
	#targetWatts = 100;
	#gradePercent = 0;
	#watts = 0;
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

	constructor(opts: SimulatedTrainerOptions = {}) {
		this.#baseWatts = opts.baseWatts ?? 180;
		this.#tau = opts.tauSeconds ?? 2;
		this.#noise = opts.noiseWatts ?? 5;
		this.#tickMs = opts.tickMs ?? 1000;
		this.#rng = opts.rng ?? Math.random;
		this.#now = opts.now ?? Date.now;
	}

	get status() {
		return this.#status;
	}

	get mode() {
		return this.#mode;
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
	}

	async setSimulation(gradePercent: number): Promise<void> {
		this.#assertConnected();
		this.#mode = 'sim';
		this.#gradePercent = gradePercent;
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
		const target =
			this.#mode === 'erg'
				? this.#targetWatts
				: Math.max(0, this.#baseWatts * (1 + 0.08 * this.#gradePercent));
		const alpha = 1 - Math.exp(-this.#tickMs / 1000 / this.#tau);
		this.#watts += (target - this.#watts) * alpha;
		const watts = Math.max(
			0,
			Math.round(this.#watts + (this.#rng() * 2 - 1) * this.#noise),
		);
		const cadence =
			watts < 20
				? 0
				: Math.round(
						clamp(85 + (watts - 200) / 15 + (this.#rng() * 2 - 1) * 2, 60, 110),
					);
		const sample: TrainerSample = { watts, cadence, at: this.#now() };
		for (const cb of this.#sampleCbs) cb(sample);
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
