import { describe, expect, it } from 'vitest';
import { scan, stale, type Allowlist } from './source-scan.test-helper';

/**
 * Durations come from the motion tokens, never literals (ux.md, #3207). A
 * `duration-200` here and a `duration-150` there is how six durations ended
 * up meaning one thing: `duration-(--dur-quick)` says which one it is.
 */
const ALLOWLIST: Allowlist = {
	'lib/session/Instrument.svelte':
		"docs/SPEC.md's Motion: the watts numeral keeps its 250 ms transform glide (#3200), and the gauge fill glides with it",
};

/** `duration-200` and `duration-[250ms]` — not `duration-(--dur-base)`. */
const LITERAL = /\bduration-(?:\d|\[\d)[\w.[\]]*/g;

describe('durations come from the motion tokens (#3207)', () => {
	it('spells no duration as a number', () => {
		const { offenders } = scan(LITERAL, ALLOWLIST);
		expect(
			offenders,
			`Literal durations:\n${offenders.join('\n')}\n` +
				'Say which one it is: duration-(--dur-quick), (--dur-base), (--dur-live)… ' +
				"(app.css, docs/SPEC.md's Motion table). A value the scale cannot say " +
				'goes in ALLOWLIST with its reason.',
		).toEqual([]);
	});

	it('keeps no allowlist entry that excuses nothing', () => {
		expect(stale(ALLOWLIST, scan(LITERAL, ALLOWLIST).used)).toEqual([]);
	});
});
