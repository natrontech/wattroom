/**
 * The boundary to sensor hardware — straps, power meters, cadence sensors.
 *
 * Parallel to `Trainer` and for the same reason: `navigator.bluetooth` is never
 * called outside an implementation of this file, which is what lets the simulator,
 * the tests and CI exist without hardware.
 *
 * Separate from `Trainer` rather than folded into it, because the two differ in the
 * thing that matters: a trainer is *controlled* (ERG targets, slope) and there is
 * exactly one; sensors are read-only and there are several at once, each of which
 * may or may not be the best source for a given metric. Arbitration lives in
 * `arbitrate.ts`, not here.
 */
import { hwlog } from './hwlog';

export type SensorStatus = 'disconnected' | 'connecting' | 'connected';

export type SensorKind = 'heart-rate' | 'power-meter' | 'cadence';

/**
 * One notification's worth of measurement. Every field is optional and absent means
 * "this sensor does not report it" — a cadence sensor sends no watts, a strap
 * without HRV support sends no RR intervals. Absent is never an error.
 */
export interface SensorReading {
	/** ms epoch */
	at: number;
	/** bpm */
	heartRate?: number;
	/** ms between beats, for HRV. Variable count per packet, often none. */
	rrIntervals?: number[];
	watts?: number;
	/** rpm */
	cadence?: number;
}

export type ReadingFields = Omit<SensorReading, 'at'>;

export interface Sensor {
	readonly kind: SensorKind;
	readonly name: string;
	readonly status: SensorStatus;
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	/** Returns unsubscribe. */
	onReading(cb: (r: SensorReading) => void): () => void;
	onStatus(cb: (s: SensorStatus) => void): () => void;
}

/**
 * Every BLE sensor we support is the same driver: connect, subscribe to one
 * notifying characteristic, parse each packet into a reading. Only the service,
 * the characteristic and the parser differ — so this is one implementation with
 * three configurations rather than three near-identical classes.
 */
export interface BleSensorSpec {
	kind: SensorKind;
	service: number;
	characteristic: number;
	defaultName: string;
	/**
	 * Built fresh per connection. Parsers that need the previous packet — anything
	 * deriving cadence from cumulative revolutions — keep that state in the closure,
	 * so reconnecting cannot compute a rate across a gap.
	 */
	createParser: () => (view: DataView) => ReadingFields | null;
}

export function createBleSensor(spec: BleSensorSpec): Sensor {
	let device: BluetoothDevice | undefined;
	let status: SensorStatus = 'disconnected';
	let name = spec.defaultName;
	/** Set on rider-initiated disconnect, so the retry loop stands down. */
	let closed = false;
	let retryDelayMs = 1000;
	/** Scopes one attach's listener, so a reattach does not stack a second. */
	let attachment: AbortController | undefined;
	const readingCbs = new Set<(r: SensorReading) => void>();
	const statusCbs = new Set<(s: SensorStatus) => void>();

	function setStatus(next: SensorStatus) {
		status = next;
		for (const cb of statusCbs) cb(next);
	}

	/**
	 * Resolve the characteristic and subscribe. Split out of `connect` so a
	 * dropout can run it again without a second `requestDevice` — the grant
	 * persists in-page, and re-opening the browser's chooser to recover from a
	 * strap slipping would be a prompt the rider cannot answer from a bike.
	 */
	async function attach(): Promise<void> {
		attachment?.abort();
		const { signal } = (attachment = new AbortController());

		const server = await device!.gatt!.connect();
		// Forget while the link was opening (#1852): same race as the trainer's.
		if (abandoned(signal)) return;
		const service = await server.getPrimaryService(spec.service);
		const characteristic = await service.getCharacteristic(spec.characteristic);

		const parse = spec.createParser();
		await characteristic.startNotifications();
		characteristic.addEventListener(
			'characteristicvaluechanged',
			(event) => {
				const view = (event.target as BluetoothRemoteGATTCharacteristic).value;
				if (!view) return;
				// A malformed packet from one strap must not take the ride down.
				let fields: ReadingFields | null;
				try {
					fields = parse(view);
				} catch (cause) {
					hwlog('error', {
						text: `sensor parse failed: ${String(cause)}`,
						sensor: spec.kind,
					});
					return;
				}
				if (!fields) return;
				const reading = { ...fields, at: Date.now() };
				// Raw bytes alongside the parse, so a hardware session can prove the
				// parser rather than just showing a plausible number (dev only).
				hwlog('sensor-packet', {
					sensor: spec.kind,
					hex: [...new Uint8Array(view.buffer)]
						.map((b) => b.toString(16).padStart(2, '0'))
						.join(' '),
					parsed: fields,
				});
				for (const cb of readingCbs) cb(reading);
			},
			{ signal },
		);

		if (abandoned(signal)) return;
		retryDelayMs = 1000;
		setStatus('connected');
	}

	/** A Forget landed while this attach was in flight: drop the link it opened. */
	function abandoned(signal: AbortSignal): boolean {
		if (!closed && !signal.aborted) return false;
		device?.gatt?.disconnect();
		return true;
	}

	function scheduleReattach(): void {
		const delay = retryDelayMs;
		retryDelayMs = Math.min(delay * 2, 30_000);
		setTimeout(() => {
			if (closed || status === 'connected') return;
			void attach().catch(scheduleReattach);
		}, delay);
	}

	return {
		kind: spec.kind,
		get name() {
			return name;
		},
		get status() {
			return status;
		},

		async connect() {
			if (!navigator.bluetooth)
				throw new Error('This browser has no Web Bluetooth');
			setStatus('connecting');
			closed = false;

			try {
				// Web Bluetooth only exposes services declared up front.
				device = await navigator.bluetooth.requestDevice({
					filters: [{ services: [spec.service] }],
					optionalServices: [spec.service],
				});
				name = device.name ?? spec.defaultName;
				// Recovery is automatic (#37, #1716): the trainer has reattached
				// with backoff since the beginning and a strap never did, so a
				// chest strap losing contact for a second dropped off the
				// dashboard for good and read as "Not connected" — no fault, no
				// way back but the browser's chooser.
				device.addEventListener('gattserverdisconnected', () => {
					if (closed) {
						setStatus('disconnected');
						return;
					}
					setStatus('connecting');
					scheduleReattach();
				});

				await attach();
			} catch (cause) {
				setStatus('disconnected');
				throw cause;
			}
		},

		async disconnect() {
			closed = true;
			device?.gatt?.disconnect();
			attachment?.abort();
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
