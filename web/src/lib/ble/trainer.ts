export type TrainerStatus = 'disconnected' | 'connecting' | 'connected';

export type ControlMode = 'erg' | 'sim';

export interface TrainerSample {
	watts: number;
	/** rpm; 0 while coasting/stopped (drives auto-pause) */
	cadence: number;
	/** ms epoch */
	at: number;
}

/**
 * The only boundary to trainer hardware. Implementations: SimulatedTrainer (dev/CI),
 * FtmsTrainer (Kickr Core+), WcpsTrainer (Kickr v2) — never call navigator.bluetooth
 * outside implementations of this interface.
 */
export interface Trainer {
	readonly name: string;
	readonly status: TrainerStatus;
	readonly mode: ControlMode;
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	/** ERG: trainer holds these watts. Implementations serialize writes behind device acks. */
	setTargetPower(watts: number): Promise<void>;
	/** Slope mode: signed grade percent (FTMS op 0x11 / WCPS op 0x46). Switches mode to 'sim'. */
	setSimulation(gradePercent: number): Promise<void>;
	/** ~1 Hz while connected. Returns unsubscribe. */
	onSample(cb: (s: TrainerSample) => void): () => void;
	onStatus(cb: (s: TrainerStatus) => void): () => void;
}
