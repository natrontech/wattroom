import { describe, expect, it } from 'vitest';

import { DEFAULTS } from '$lib/workout/guards';
import { COUNTDOWN_SECONDS, SIGNAL_LOST_MS } from '$lib/workout/session.svelte';
import { SPRINT_LEAD_SECONDS } from '$lib/workout/sprint-window.svelte';

/**
 * The numbers docs/SPEC.md fixes, pinned to their literals.
 *
 * Every behavioural test in the suite reads the constant it is checking —
 * `expect(session.countdownRemaining).toBe(COUNTDOWN_SECONDS)`, loops bounded
 * by `DEFAULTS.pauseAfterSeconds`. That is the right way to write them: they
 * test the machine, not the number. It also means retuning a constant retunes
 * its own expectation, so nothing was the guard for the number itself — a
 * count-in of 11 s and an auto-pause tripping at 44 rpm both passed all 1658
 * tests (#2363).
 *
 * So this file asserts one thing only: that the code still says what the spec
 * says. A deliberate change edits docs/SPEC.md and this table together; an
 * accidental one fails here, naming the line to go and read.
 *
 * Only numbers docs/SPEC.md actually states belong here. `biasStep` is not one
 * of them, and the tolerance band comes from the generated protocol (#2122),
 * where codegen already stops the server and the app disagreeing.
 */
const SPEC: ReadonlyArray<readonly [string, number, number, string]> = [
	// [what, actual, docs/SPEC.md's value, where it says so]
	[
		'count-in before the clock starts',
		COUNTDOWN_SECONDS,
		3,
		'SPEC:151 — "3 s count-in"',
	],
	[
		'a silent trainer',
		SIGNAL_LOST_MS,
		3000,
		'SPEC:484 — "sent nothing for 3 s is silent"',
	],
	[
		'klaxon before a sprint',
		SPRINT_LEAD_SECONDS,
		3,
		'SPEC:470 — "klaxon 3 s before"',
	],

	[
		'auto-pause: stopped cadence',
		DEFAULTS.pauseCadence,
		5,
		'SPEC:417 — "Stopped = cadence below | 5 rpm"',
	],
	[
		'auto-pause: still-pedalling watts',
		DEFAULTS.pedallingWatts,
		20,
		'SPEC:418 — "…AND power below | 20 W"',
	],
	[
		'auto-pause: after',
		DEFAULTS.pauseAfterSeconds,
		3,
		'SPEC:419 — "Pause after | 3 s stopped"',
	],
	[
		'auto-pause: resume countdown',
		DEFAULTS.resumeCountdown,
		3,
		'SPEC:420 — "Resume countdown | 3 s"',
	],

	[
		'spiral guard: trip cadence',
		DEFAULTS.spiralCadence,
		50,
		'SPEC:425 — "Trip: cadence below | 50 rpm"',
	],
	[
		'spiral guard: for',
		DEFAULTS.spiralAfterSeconds,
		5,
		'SPEC:426 — "…for | 5 consecutive seconds"',
	],
	[
		'spiral guard: power fallback',
		DEFAULTS.spiralPowerFraction,
		0.5,
		'SPEC:427 — "power below 50 % of target"',
	],
	[
		'spiral guard: release',
		DEFAULTS.spiralReleaseSeconds,
		10,
		'SPEC:428 — "Release duration | 10 s"',
	],

	['bias floor', DEFAULTS.biasMin, 0.8, 'SPEC:300 — "their bias (0.8–1.2…)"'],
	['bias ceiling', DEFAULTS.biasMax, 1.2, 'SPEC:300 — "their bias (0.8–1.2…)"'],
];

describe('the numbers docs/SPEC.md fixes', () => {
	it.each(SPEC)('%s', (_what, actual, expected, where) => {
		expect(actual, `docs/SPEC.md fixes this: ${where}`).toBe(expected);
	});
});
