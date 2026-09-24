import type { SensorKind } from '$lib/ble/sensor';
import type { SensorPairing } from '$lib/protocol';
import type { createRide } from '$lib/session/ride.svelte';
import { SENSOR_KINDS, sensors } from '$lib/sensors.svelte';
import type { Trainer } from '$lib/ble/trainer';

/**
 * The pairing state machine, in one place: `/settings/equipment` and the Training place's
 * paired-devices overview both read the trainer and the three read-only
 * sensors, and used to compute "idle vs connecting vs connected vs failed"
 * twice from the same underlying stores (code-quality.md).
 */
/**
 * The machine itself is untouched (#1000) — this is still the same four
 * states, said in the same order, and every helper below still returns
 * exactly what it always did. Only the type's home moved: it used to be
 * `Exclude<SlotState, 'requesting'>` off `DeviceSlot`, and `DeviceSlot` is
 * gone. 'requesting' was never one of these states — it was that component's
 * own word for "the browser's picker is open", which no helper here has ever
 * returned — so nothing is lost by naming the four directly.
 */
export type PairState =
	'idle' | 'connecting' | 'reconnecting' | 'connected' | 'failed';

/**
 * #520's fault states, said as the same four-state machine every slot uses.
 *
 * "The chooser is open" comes off the store that owns the trainer rather than
 * from the caller (#1716): it used to be a component's own `$state`, so two
 * overviews on screen disagreed about which card was connecting and
 * navigating mid-pair lost the spinner.
 */
/**
 * The trainer's own trouble (#520): the link is down, or it is up and no
 * watts arrive — which is `silent` when nothing at all comes over the link,
 * and `no-power` when frames do but none carries power (#1849): a unit that
 * reports cadence or speed and never watts, which "turn the cranks" would
 * not fix and a power meter would.
 */
export type TrainerFault = 'reconnecting' | 'silent' | 'no-power' | null;

/** Ten seconds without a sample: which of the two quiet faults is it? */
export function quietFault(
	trainer: Pick<Trainer, 'frames' | 'poweredFrames'>,
): TrainerFault {
	return trainer.frames && !trainer.poweredFrames ? 'no-power' : 'silent';
}

/** The one line under a paired-but-quiet trainer, on every pairing surface. */
export function trainerHint(
	fault: TrainerFault | undefined,
): string | undefined {
	if (fault === 'silent') return 'no watts yet — turn the cranks';
	if (fault === 'no-power')
		return 'reporting, but not power — this unit sends no watts; pair a power meter';
	return undefined;
}

export function trainerState(
	ride: Pick<
		ReturnType<typeof createRide>,
		'trainer' | 'fault' | 'error' | 'pairing'
	>,
): PairState {
	if (ride.pairing) return 'connecting';
	if (!ride.trainer) return ride.error ? 'failed' : 'idle';
	return ride.fault === 'reconnecting' ? 'reconnecting' : 'connected';
}

export function sensorState(kind: SensorKind): PairState {
	if (sensors.pairing === kind) return 'connecting';
	const slot = sensors.slot(kind);
	if (slot.status === 'connected') return 'connected';
	// Reattaching after a dropout (#1716). Not 'connecting': the chooser is
	// not open, nothing is waiting on the rider, and without a state of its
	// own a strap that slipped read as never paired — a fault drawn as
	// nothing, and no way to give up on it.
	if (slot.status === 'connecting') return 'reconnecting';
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
 * whenever there is no voice channel connection at all, which is why the solo
 * `/ride` and `/ramp` screens keep behaving exactly as they always did.
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
	return `${where === here ? 'in' : 'on'} ${otherScreen(where, here)}`;
}

/**
 * The rider's other screen, as the bare place: "your phone", "another tab".
 *
 * One name for it (#2075): the card that says "Paired on your phone" and the
 * one that says "Targets come from your phone" are about the same screen, and
 * a rider reading both must not have to work out that they are.
 */
function otherScreen(where: string, here: string): string {
	return where === here ? 'another tab' : `your ${where}`;
}

/**
 * The one line a screen that no longer drives the trainer says (#2075) —
 * "Targets come from your phone", or undefined while this screen is the one
 * driving.
 *
 * The same claim `mayActuate` refuses on, said as a sentence: a screen that
 * keeps its GATT link, its samples and its Forget and writes no control point
 * (ADR-0025, amended) otherwise draws the ordinary live card and says nothing
 * at all about where the resistance comes from.
 *
 * It names the other screen and stops there. Nothing is broken, nothing has
 * to be fixed, and a tone that implied either would be a fault reported where
 * there is none (errors.md). Written once here because two surfaces say it —
 * the trainer card, and the bias trim it explains.
 */
export function trainerTargetsNote(
	pairing: SensorPairing | undefined,
	here: string,
): string | undefined {
	const where = pairing?.elsewhere?.trainer;
	if (!where) return undefined;
	return `Targets come from ${otherScreen(where, here)}`;
}

/**
 * May this screen write the trainer's control point? (#1853)
 *
 * ADR-0025's claim arbitrated the sample stream and the pairing affordance
 * and stopped there, so two tabs with a GATT link to one trainer both
 * actuated — the same watts until their per-tab `bias` differed, and then a
 * 1 Hz fight over the trainer of a ride in progress. The claim covers
 * actuation too (ADR-0025, amended 2026-09-10).
 *
 * The rule is the hub's own `ownsTrainerLocked`, said again on this side
 * because the hub cannot refuse a Bluetooth write it never sees: a trainer
 * claim held by another of the rider's screens refuses this one, and
 * everything else rides exactly as before. That "everything else" is
 * load-bearing — it is the solo `/ride` and `/ramp` screens, which hold no
 * socket to arbitrate on, and it is a tab whose answer has not arrived yet or
 * whose socket is down. Silencing either would take a rider's resistance
 * away with nothing at all contending for the trainer.
 */
export function mayActuate(pairing: SensorPairing | undefined): boolean {
	return !pairing?.elsewhere?.trainer;
}

/**
 * Nothing to ride on (#2594): no trainer linked on this screen, and none on
 * another of the rider's. What a session asks about before its start, and
 * again beside a countdown the rider did not start.
 */
export function needsTrainer(
	trainer: unknown,
	pairing: SensorPairing | undefined,
): boolean {
	return !trainer && !pairing?.elsewhere?.trainer;
}

/**
 * Every kind the rider holds on another screen, ready to render (#610) —
 * what the paired-devices grid takes, so the grid itself needs to know
 * nothing about sockets or claims.
 *
 * Empty when there is no voice channel connection, which is how the solo
 * `/ride` and `/ramp` screens keep their pair buttons.
 */
export function pairedElsewhereAll(
	pairing: SensorPairing | undefined,
	here: string,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const kind of ['trainer', ...SENSOR_KINDS] as const) {
		const where = pairedElsewhere(kind, pairing, here);
		if (where) out[kind] = where;
	}
	return out;
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
