import { createCadenceSensor } from '$lib/ble/cadence';
import { pairError } from '$lib/ble/pair-error';
import { createHeartRateSensor } from '$lib/ble/heartrate';
import { createPowerMeterSensor } from '$lib/ble/cyclingpower';
import { createSimulatedSensor } from '$lib/ble/simulated-sensor';
import type {
	Sensor,
	SensorKind,
	SensorReading,
	SensorStatus,
} from '$lib/ble/sensor';

/**
 * The connected sensors, shared across the app (#11).
 *
 * A module singleton rather than a per-component store, because a BLE connection is
 * expensive to establish and belongs to the session, not to a screen: a rider pairs
 * a strap in Settings › Equipment and expects it still connected when they start riding. Nothing
 * persists — Web Bluetooth grants do not survive a reload, and pretending otherwise
 * would mean showing a paired device that is not there.
 */
export interface SensorSlot {
	kind: SensorKind;
	status: SensorStatus;
	name?: string;
	error?: string;
	latest?: SensorReading;
}

const factories: Record<SensorKind, () => Sensor> = {
	'heart-rate': createHeartRateSensor,
	'power-meter': createPowerMeterSensor,
	cadence: createCadenceSensor,
};

export const SENSOR_KINDS: SensorKind[] = [
	'heart-rate',
	'power-meter',
	'cadence',
];

function blank(kind: SensorKind): SensorSlot {
	return { kind, status: 'disconnected' };
}

const slots = $state<Record<SensorKind, SensorSlot>>({
	'heart-rate': blank('heart-rate'),
	'power-meter': blank('power-meter'),
	cadence: blank('cadence'),
});

/**
 * The sensor holding each slot, and the subscriptions wiring it there — a
 * sensor whose callbacks are still registered is still writing to the card,
 * whatever the map says (#1716).
 */
const live = new Map<SensorKind, { sensor: Sensor; release: () => void }>();

/**
 * The kind whose chooser is open (#1716). On the singleton rather than in
 * each overview component: two grids on screen used to disagree about which
 * card said "Connecting…", and navigating while the picker was up lost the
 * spinner entirely.
 */
let pairing = $state<SensorKind | null>(null);

function attach(kind: SensorKind, sensor: Sensor) {
	const offs = [
		sensor.onStatus((status) => {
			slots[kind].status = status;
			// Anything but connected drops the reading (#1716). A sensor
			// reattaching still has its last packet, and a stale bpm rendered in
			// the live-data colour is the one thing the card must never do.
			if (status !== 'connected') slots[kind].latest = undefined;
		}),
		sensor.onReading((reading) => {
			slots[kind].latest = reading;
		}),
	];
	live.set(kind, {
		sensor,
		release: () => {
			for (const off of offs) off();
		},
	});
}

/** Hang up whatever holds this slot and stop listening to it. */
function releaseSlot(kind: SensorKind): Promise<void> | undefined {
	const held = live.get(kind);
	live.delete(kind);
	if (!held) return;
	held.release();
	return held.sensor.disconnect();
}

export const sensors = {
	get all(): SensorSlot[] {
		return SENSOR_KINDS.map((kind) => slots[kind]);
	},
	slot(kind: SensorKind): SensorSlot {
		return slots[kind];
	},
	/** The kind whose chooser is open, if any. */
	get pairing(): SensorKind | null {
		return pairing;
	},
	/** Latest reading per kind, in the shape `arbitrate` wants. */
	get readings(): Partial<Record<SensorKind, SensorReading>> {
		const out: Partial<Record<SensorKind, SensorReading>> = {};
		for (const kind of SENSOR_KINDS) {
			const reading = slots[kind].latest;
			if (reading) out[kind] = reading;
		}
		return out;
	},

	async pair(kind: SensorKind, simulated = false): Promise<void> {
		if (pairing) return;
		// Release before attach (#1716): pairing over a live sensor left the
		// first one connected and still writing into this slot, where nothing
		// could reach it to hang it up — two straps, one card, and whichever
		// notified last won.
		await releaseSlot(kind);
		slots[kind] = blank(kind);
		pairing = kind;
		const sensor = simulated ? createSimulatedSensor(kind) : factories[kind]();
		attach(kind, sensor);
		try {
			await sensor.connect();
			slots[kind].name = sensor.name;
		} catch (cause) {
			await releaseSlot(kind);
			slots[kind].error = pairError(cause);
		} finally {
			pairing = null;
		}
	},

	async forget(kind: SensorKind): Promise<void> {
		await releaseSlot(kind);
		slots[kind] = blank(kind);
	},
};
