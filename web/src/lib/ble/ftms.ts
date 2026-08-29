import type {
	ControlMode,
	Trainer,
	TrainerSample,
	TrainerStatus,
} from './trainer';

/**
 * FTMS trainer driver (Kickr Core and every other post-2021 conformant unit).
 *
 * Protocol facts and the parsing traps come from docs/RESEARCH.md §1 and §11 —
 * read those before changing the parser, several of them are counter-intuitive.
 */
const FTMS_SERVICE = 0x1826;
const INDOOR_BIKE_DATA = 0x2ad2;
const CONTROL_POINT = 0x2ad9;
const SUPPORTED_POWER_RANGE = 0x2ad8;
const MACHINE_STATUS = 0x2ada;
/** Cycling Power Service — declared so a WCPS-only unit can be detected later. */
const CPS_SERVICE = 0x1818;

const OP_REQUEST_CONTROL = 0x00;
const OP_SET_TARGET_POWER = 0x05;
const OP_SET_SIMULATION = 0x11;
const OP_RESPONSE = 0x80;
const RESULT_SUCCESS = 0x01;
/** Fitness Machine Status: control permission lost — we have to ask again. */
const STATUS_CONTROL_LOST = 0xff;

export interface PowerRange {
	minWatts: number;
	maxWatts: number;
	incrementWatts: number;
}

/**
 * When the range characteristic is missing or malformed. 3000 W matches the
 * bound the server already puts on rider metrics — effectively no clamp, while
 * still refusing numbers no trainer on earth accepts.
 */
export const DEFAULT_POWER_RANGE: PowerRange = {
	minWatts: 0,
	maxWatts: 3000,
	incrementWatts: 1,
};

/**
 * Parse Supported Power Range (0x2AD8): sint16 min, sint16 max, uint16 increment.
 *
 * Defensive about width because the Kickr Core taught us to be (#59): its CPS
 * Feature characteristic returns 2 bytes where the spec says 4, so no capability
 * read gets to assume its advertised length. A short or nonsensical value falls
 * back to the default rather than clamping every target to garbage.
 */
export function parsePowerRange(view: DataView): PowerRange {
	if (view.byteLength < 6) return DEFAULT_POWER_RANGE;
	const range: PowerRange = {
		minWatts: view.getInt16(0, true),
		maxWatts: view.getInt16(2, true),
		incrementWatts: view.getUint16(4, true) || 1,
	};
	if (range.maxWatts <= range.minWatts) return DEFAULT_POWER_RANGE;
	return range;
}

/**
 * Clamp an ERG target to what the trainer advertises. A target outside the range
 * is rejected at the control point, and our writes serialize behind the 0x80
 * indication — so an unclamped target is not a wrong number, it is a stall on a
 * ride-critical path. Also rounds onto the trainer's increment grid.
 */
export function clampTarget(watts: number, range: PowerRange): number {
	const stepped =
		Math.round(watts / range.incrementWatts) * range.incrementWatts;
	return Math.min(range.maxWatts, Math.max(range.minWatts, stepped));
}

export interface IndoorBikeData {
	watts?: number;
	cadence?: number;
	speedKph?: number;
	heartRate?: number;
}

/**
 * Parse Indoor Bike Data (0x2AD2).
 *
 * Two traps, both from RESEARCH.md §11:
 *  - bit 0 is INVERTED: More Data = 0 means instantaneous speed IS present.
 *  - the spec's Table 4.10 prints bit 2 inverted as well, but that is a known
 *    spec typo — real trainers set bit 2 = 1 when cadence is included.
 * Exported for unit tests: this is the one function worth pinning down.
 */
export function parseIndoorBikeData(view: DataView): IndoorBikeData {
	const flags = view.getUint16(0, true);
	let offset = 2;
	const out: IndoorBikeData = {};

	if (!(flags & 0x0001)) {
		out.speedKph = view.getUint16(offset, true) * 0.01;
		offset += 2;
	}
	if (flags & 0x0002) offset += 2; // average speed
	if (flags & 0x0004) {
		out.cadence = view.getUint16(offset, true) * 0.5; // half-rpm resolution
		offset += 2;
	}
	if (flags & 0x0008) offset += 2; // average cadence
	if (flags & 0x0010) offset += 3; // total distance, uint24
	if (flags & 0x0020) offset += 2; // resistance level
	if (flags & 0x0040) {
		out.watts = view.getInt16(offset, true);
		offset += 2;
	}
	if (flags & 0x0080) offset += 2; // average power
	if (flags & 0x0100) offset += 5; // energy trio
	if (flags & 0x0200) {
		out.heartRate = view.getUint8(offset);
		offset += 1;
	}
	return out;
}

export class FtmsTrainer implements Trainer {
	name = 'FTMS trainer';

	#status: TrainerStatus = 'disconnected';
	#mode: ControlMode = 'erg';
	#device?: BluetoothDevice;
	#control?: BluetoothRemoteGATTCharacteristic;

	#sampleCbs = new Set<(s: TrainerSample) => void>();
	#logCbs = new Set<(text: string, ms?: number) => void>();
	/** Latest full frame, including fields the Trainer interface does not carry. */
	lastFrame: IndoorBikeData = {};
	#statusCbs = new Set<(s: TrainerStatus) => void>();

	/**
	 * A control-point write during an in-progress procedure is rejected at the ATT
	 * layer ("Procedure Already In Progress"), so every write waits for its 0x80
	 * indication before the next one starts (RESEARCH.md §1).
	 */
	#queue: Promise<void> = Promise.resolve();
	#pending?: { resolve: () => void; reject: (e: Error) => void; timer: number };
	#range: PowerRange = DEFAULT_POWER_RANGE;

	get status() {
		return this.#status;
	}
	get mode() {
		return this.#mode;
	}

	async connect(): Promise<void> {
		if (!navigator.bluetooth)
			throw new Error('This browser has no Web Bluetooth');
		this.#setStatus('connecting');

		// Web Bluetooth only exposes services declared up front.
		this.#device = await navigator.bluetooth.requestDevice({
			filters: [{ services: [FTMS_SERVICE] }],
			optionalServices: [FTMS_SERVICE, CPS_SERVICE],
		});
		this.name = this.#device.name ?? 'FTMS trainer';
		this.#device.addEventListener('gattserverdisconnected', () =>
			this.#setStatus('disconnected'),
		);

		const server = await this.#device.gatt!.connect();
		const service = await server.getPrimaryService(FTMS_SERVICE);

		const bikeData = await service.getCharacteristic(INDOOR_BIKE_DATA);
		await bikeData.startNotifications();
		bikeData.addEventListener('characteristicvaluechanged', (event) => {
			const view = (event.target as BluetoothRemoteGATTCharacteristic).value;
			if (!view) return;
			const data = parseIndoorBikeData(view);
			this.lastFrame = data;
			if (data.watts === undefined) return;
			for (const cb of this.#sampleCbs) {
				cb({
					watts: data.watts,
					cadence: Math.round(data.cadence ?? 0),
					// Already parsed out of Indoor Bike Data; it used to stop here (#44).
					heartRate: data.heartRate,
					at: Date.now(),
				});
			}
		});

		this.#control = await service.getCharacteristic(CONTROL_POINT);
		await this.#control.startNotifications();
		this.#control.addEventListener('characteristicvaluechanged', (event) => {
			const view = (event.target as BluetoothRemoteGATTCharacteristic).value;
			if (!view || view.getUint8(0) !== OP_RESPONSE) return;
			const result = view.getUint8(2);
			const pending = this.#pending;
			this.#pending = undefined;
			if (!pending) return;
			clearTimeout(pending.timer);
			if (result === RESULT_SUCCESS) pending.resolve();
			else
				pending.reject(
					new Error(`FTMS op rejected, result 0x${result.toString(16)}`),
				);
		});

		// Machine Status tells us when the trainer takes control back (0xFF).
		try {
			const status = await service.getCharacteristic(MACHINE_STATUS);
			await status.startNotifications();
			status.addEventListener('characteristicvaluechanged', (event) => {
				const view = (event.target as BluetoothRemoteGATTCharacteristic).value;
				if (view?.getUint8(0) === STATUS_CONTROL_LOST) {
					void this.#write(Uint8Array.of(OP_REQUEST_CONTROL).buffer);
				}
			});
		} catch {
			// Optional characteristic; a unit without it just cannot report lost control.
		}

		// Optional read; a unit without it just gets the permissive default.
		try {
			const rangeChar = await service.getCharacteristic(SUPPORTED_POWER_RANGE);
			this.#range = parsePowerRange(await rangeChar.readValue());
		} catch {
			this.#range = DEFAULT_POWER_RANGE;
		}

		// One grant covers every procedure until disconnect.
		await this.#write(Uint8Array.of(OP_REQUEST_CONTROL).buffer);
		this.#setStatus('connected');
	}

	async disconnect(): Promise<void> {
		this.#device?.gatt?.disconnect();
		this.#setStatus('disconnected');
	}

	async setTargetPower(watts: number): Promise<void> {
		const payload = new DataView(new ArrayBuffer(3));
		payload.setUint8(0, OP_SET_TARGET_POWER);
		payload.setInt16(1, clampTarget(Math.max(0, watts), this.#range), true);
		this.#mode = 'erg';
		await this.#write(payload.buffer);
	}

	async setSimulation(gradePercent: number): Promise<void> {
		const payload = new DataView(new ArrayBuffer(7));
		payload.setUint8(0, OP_SET_SIMULATION);
		payload.setInt16(1, 0, true); // wind speed, 0.001 m/s
		payload.setInt16(3, Math.round(gradePercent * 100), true); // grade, 0.01 %
		payload.setUint8(5, 40); // Crr 0.0040
		payload.setUint8(6, 51); // Cw 0.51 kg/m
		this.#mode = 'sim';
		await this.#write(payload.buffer);
	}

	onSample(cb: (s: TrainerSample) => void): () => void {
		this.#sampleCbs.add(cb);
		return () => this.#sampleCbs.delete(cb);
	}

	/** Instrumentation for the hardware session: every control-point round trip. */
	onLog(cb: (text: string, ms?: number) => void): () => void {
		this.#logCbs.add(cb);
		return () => this.#logCbs.delete(cb);
	}

	onStatus(cb: (s: TrainerStatus) => void): () => void {
		this.#statusCbs.add(cb);
		return () => this.#statusCbs.delete(cb);
	}

	/** Serialised: each write resolves only once its indication lands. */
	#write(bytes: ArrayBuffer): Promise<void> {
		this.#queue = this.#queue.then(async () => {
			if (!this.#control) throw new Error('not connected');
			const sentAt = performance.now();
			const done = new Promise<void>((resolve, reject) => {
				// A trainer that never indicates would otherwise wedge the queue forever.
				const timer = setTimeout(() => {
					this.#pending = undefined;
					reject(new Error('FTMS control point timed out'));
				}, 3000) as unknown as number;
				this.#pending = { resolve, reject, timer };
			});
			await this.#control.writeValueWithResponse(bytes);
			await done;
			const ms = Math.round(performance.now() - sentAt);
			for (const cb of this.#logCbs) cb('control point acknowledged', ms);
		});
		return this.#queue;
	}

	#setStatus(next: TrainerStatus): void {
		this.#status = next;
		for (const cb of this.#statusCbs) cb(next);
	}
}
