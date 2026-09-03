import type { SlotState } from '$lib/components/DeviceSlot.svelte';
import type { SensorKind } from '$lib/ble/sensor';
import type { SensorPairing } from '$lib/protocol';
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

/**
 * The phrase for a sensor one of the rider's OTHER screens holds (#610), or
 * undefined when this screen is free to pair it — "on your phone", "in
 * another tab".
 *
 * Server truth, not a guess: the hub arbitrates the claim, so a tab that lost
 * the race says so rather than showing a trainer it never got. Undefined
 * whenever there is no room connection at all, which is why the solo `/ride`
 * and `/ramp` screens keep behaving exactly as they always did.
 *
 * `here` is this screen's own word, because "paired on your desktop" while
 * you are sitting at the desktop is a riddle rather than an answer.
 */
export function pairedElsewhere(
	kind: SensorKind | 'trainer',
	pairing: SensorPairing | undefined,
	here: string,
): string | undefined {
	const where = pairing?.elsewhere?.[kind];
	if (!where) return undefined;
	return where === here ? 'in another tab' : `on your ${where}`;
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
