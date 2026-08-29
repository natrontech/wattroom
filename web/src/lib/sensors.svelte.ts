import { createCadenceSensor } from '$lib/ble/cadence';
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
 * a strap on /pair and expects it still connected when they start riding. Nothing
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

const live = new Map<SensorKind, Sensor>();

function attach(kind: SensorKind, sensor: Sensor) {
	live.set(kind, sensor);
	sensor.onStatus((status) => {
		slots[kind].status = status;
		if (status === 'disconnected') slots[kind].latest = undefined;
	});
	sensor.onReading((reading) => {
		slots[kind].latest = reading;
	});
}

export const sensors = {
	get all(): SensorSlot[] {
		return SENSOR_KINDS.map((kind) => slots[kind]);
	},
	slot(kind: SensorKind): SensorSlot {
		return slots[kind];
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
		slots[kind].error = undefined;
		const sensor = simulated ? createSimulatedSensor(kind) : factories[kind]();
		attach(kind, sensor);
		try {
			await sensor.connect();
			slots[kind].name = sensor.name;
		} catch (cause) {
			live.delete(kind);
			slots[kind].error = message(cause);
		}
	},

	async forget(kind: SensorKind): Promise<void> {
		await live.get(kind)?.disconnect();
		live.delete(kind);
		slots[kind] = blank(kind);
	},
};

/**
 * Web Bluetooth's own errors are the useful ones — "User cancelled the requestDevice
 * chooser" says exactly what happened. Only the unrecognised case gets a rewrite.
 */
function message(cause: unknown): string {
	if (cause instanceof DOMException && cause.name === 'NotFoundError')
		return 'No device picked. Wake the sensor — spin the cranks or press its button — and try again.';
	if (cause instanceof Error) return cause.message;
	return 'Could not connect to that sensor.';
}
