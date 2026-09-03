import type { SlotState } from '$lib/components/DeviceSlot.svelte';
import type { SensorKind } from '$lib/ble/sensor';
import type { createRide } from '$lib/room/ride.svelte';
import { sensors } from '$lib/sensors.svelte';

/**
 * The pairing state machine, in one place: `/pair` and the Training place's
 * paired-devices overview both read the trainer and the three read-only
 * sensors, and used to compute "idle vs connecting vs connected vs failed"
 * twice from the same underlying stores (code-quality.md).
 */
export type Pairing = SensorKind | 'trainer' | null;

/**
 * Neither helper below ever asks for the browser's own picker dialog
 * ('requesting' — that's `DeviceSlot`'s to show while a caller awaits its
 * own `navigator.bluetooth.requestDevice`), so callers get the narrower
 * union rather than casting away `SlotState`'s full range every time.
 */
export type PairState = Exclude<SlotState, 'requesting'>;

/** #520's fault states, said as the same four-state machine every slot uses. */
export function trainerState(
	ride: Pick<ReturnType<typeof createRide>, 'trainer' | 'fault' | 'error'>,
	pairing: Pairing,
): PairState {
	if (pairing === 'trainer') return 'connecting';
	if (!ride.trainer) return ride.error ? 'failed' : 'idle';
	return ride.fault === 'reconnecting' ? 'connecting' : 'connected';
}

export function sensorState(kind: SensorKind, pairing: Pairing): PairState {
	if (pairing === kind) return 'connecting';
	const slot = sensors.slot(kind);
	if (slot.status === 'connected') return 'connected';
	if (slot.error) return 'failed';
	return 'idle';
}

/** Live-ness is the honest confirmation: paired but silent is not working. */
export function sensorReading(kind: SensorKind): string | undefined {
	const latest = sensors.slot(kind).latest;
	if (!latest) return undefined;
	if (latest.heartRate !== undefined) return `${latest.heartRate} bpm`;
	if (latest.watts !== undefined)
		return `${latest.watts} W · ${latest.cadence ?? 0} rpm`;
	if (latest.cadence !== undefined) return `${latest.cadence} rpm`;
	return undefined;
}
