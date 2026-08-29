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
	const readingCbs = new Set<(r: SensorReading) => void>();
	const statusCbs = new Set<(s: SensorStatus) => void>();

	function setStatus(next: SensorStatus) {
		status = next;
		for (const cb of statusCbs) cb(next);
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

			try {
				// Web Bluetooth only exposes services declared up front.
				device = await navigator.bluetooth.requestDevice({
					filters: [{ services: [spec.service] }],
					optionalServices: [spec.service],
				});
				name = device.name ?? spec.defaultName;
				device.addEventListener('gattserverdisconnected', () =>
					setStatus('disconnected'),
				);

				const server = await device.gatt!.connect();
				const service = await server.getPrimaryService(spec.service);
				const characteristic = await service.getCharacteristic(
					spec.characteristic,
				);

				const parse = spec.createParser();
				await characteristic.startNotifications();
				characteristic.addEventListener(
					'characteristicvaluechanged',
					(event) => {
						const view = (event.target as BluetoothRemoteGATTCharacteristic)
							.value;
						if (!view) return;
						// A malformed packet from one strap must not take the ride down.
						let fields: ReadingFields | null;
						try {
							fields = parse(view);
						} catch {
							return;
						}
						if (!fields) return;
						const reading = { ...fields, at: Date.now() };
						for (const cb of readingCbs) cb(reading);
					},
				);

				setStatus('connected');
			} catch (cause) {
				setStatus('disconnected');
				throw cause;
			}
		},

		async disconnect() {
			device?.gatt?.disconnect();
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
