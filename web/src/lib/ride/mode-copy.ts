/**
 * What the free ride says, said once (#3203). The riding surface carries no
 * teaching line (TARGETS G4): the mode's toggle and the trainer chip say
 * what rides. What is left is Settings › Equipment's words, and the one
 * line that tells a rider who kept them that gears exist (#3333).
 */

/** Settings › Equipment's `singleSpeed`, said as what it does (ADR-0084). */
export const DONT_SHIFT_SETTING = {
	label: "Don't make me shift",
	hint: 'WattRoom holds watts wherever it would put you on a slope.',
} as const;

/** Once, to a rider on "Don't make me shift" from before gears (#3333). */
export const GEARS_NEWS_LINE = 'Virtual gears are here: pick Grade to shift.';
