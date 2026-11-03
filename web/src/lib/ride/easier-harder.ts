import type { GearState } from '$lib/protocol';
import { WATTS } from '$lib/ride/free-ride-controls';
import { DEFAULTS } from '$lib/workout/guards';

/**
 * Why Easier / Harder does nothing here — the one line the controls show
 * beside them, disabled (ux.md: never a press that fails).
 */
export const EASIER_HARDER_OFF = {
	gated: 'Easier and Harder are not switched on here yet.',
	noTrainer: 'Pair your trainer to make the ride easier or harder.',
	lost: 'Another of your screens has the trainer.',
	idle: 'Easier and Harder start with the ride.',
	fixed: 'This ride sets your watts: nothing to make easier or harder.',
} as const;

/** One Easier / Harder press: whether anything moved, or why nothing can. */
export type EasierHarder = { moved: boolean } | { disabled: string };

/** What a press moves in ERG, when anything: true when it moved. */
export type ErgPress = (dir: 1 | -1) => boolean;

/**
 * An ERG press over a value and its nudge — a workout's bias, the free
 * ride's watts. It moved when the value did: a clamp at an end holds it.
 */
export function ergPress(
	read: () => number,
	nudge: (dir: 1 | -1) => void,
): ErgPress {
	return (dir) => {
		const was = read();
		nudge(dir);
		return read() !== was;
	};
}

/** The ERG half for a workout: its bias, one step a press, 0.8–1.2 (#795). */
export function biasPress(
	bias: () => number,
	nudgeBias: (step: number) => void,
): ErgPress {
	return ergPress(bias, (dir) => nudgeBias(dir * DEFAULTS.biasStep));
}

/**
 * What an Easier / Harder tap moved, as the phone remote shows it (#3334;
 * docs/SPEC.md "Phone"): the gear in SIM; in ERG the workout's bias or the
 * free ride's watts, as the riding screen words them. Each says whether the
 * next tap would hit an end. Null when the tap moves nothing here.
 */
export function shiftAnswer(
	ride: {
		sim: boolean;
		gear: { label: string };
		atEnd(dir: 1 | -1): boolean;
	},
	erg: { bias: number } | { watts: number } | null,
): GearState | null {
	if (ride.sim)
		return { label: ride.gear.label, atEnd: ride.atEnd(1) || ride.atEnd(-1) };
	if (erg && 'bias' in erg)
		return {
			label: `Bias ${Math.round(erg.bias * 100)}%`,
			atEnd: erg.bias <= DEFAULTS.biasMin || erg.bias >= DEFAULTS.biasMax,
		};
	if (erg)
		return {
			label: `${Math.round(erg.watts)} W`,
			atEnd: erg.watts <= WATTS.min || erg.watts >= WATTS.max,
		};
	return null;
}
