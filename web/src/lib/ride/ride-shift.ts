import { shifterSlot } from '$lib/ble/controller-slot.svelte';
import { play } from '$lib/sound/cues';
import type { CueId } from '$lib/sound/cue-catalogue';
import type { EasierHarder } from '$lib/ride/easier-harder';
import { GEAR_INPUTS, gearsEnabled, inputOf } from '$lib/ride/gears-enabled';
import { createShiftDriver, type ShiftDir } from '$lib/ride/shifter';

/**
 * One ride's shifting (#3330): every input — the keys, the on-screen pair —
 * presses one shifter, each move is one Easier / Harder press on the ride,
 * and each is heard, since a rider does not watch the screen (ux.md): two
 * ticks rising or falling for a gear, `block` at an end, once per press and
 * never on a held repeat (docs/SPEC.md "The shifter"). A press from an
 * input whose switch is off moves nothing (ADR-0084 "Inputs").
 */
/** A shift heard, and felt on a paired controller that vibrates (ADR-0084 rule 2). */
function announce(id: CueId) {
	play(id);
	shifterSlot.feel(id === 'block' ? 'end' : 'shift');
}

export function createRideShift(
	ride: {
		easierHarder(dir: ShiftDir): EasierHarder;
		atEnd(dir: ShiftDir): boolean;
	},
	cue: (id: CueId) => void = announce,
	now?: () => number,
	inputs = GEAR_INPUTS,
) {
	const driver = createShiftDriver(
		(event) => {
			if (event.kind === 'end') return cue('block');
			const press = ride.easierHarder(event.dir);
			if ('moved' in press && press.moved)
				cue(event.dir > 0 ? 'shift-up' : 'shift-down');
		},
		(dir) => ride.atEnd(dir),
		now,
	);
	return {
		...driver,
		press(dir: ShiftDir, source: string) {
			if (gearsEnabled(inputOf(source), inputs)) driver.press(dir, source);
		},
	};
}

export type RideShift = ReturnType<typeof createRideShift>;
