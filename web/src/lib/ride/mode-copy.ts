/**
 * What the free ride says, said once (#3203). The riding surface carries no
 * teaching line (TARGETS G4): the mode's toggle and the trainer chip say
 * what rides. What is left is the one hint for a control whose precondition
 * is absent (ux.md), and Settings › Equipment's words.
 */

/** Grade on a one-gear setup: slope mode has no usable range there. */
export const ONE_GEAR_LINE =
	'One gear: the grade has no range here, use Watts.';

/** Settings › Equipment's `singleSpeed`, said as what it does. */
export const ONE_GEAR_SETTING = {
	label: "One gear (Zwift Cog), or don't make me shift",
	hint: 'WattRoom holds watts wherever it would put you on a slope.',
} as const;
