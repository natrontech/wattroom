import { describe, expect, it } from 'vitest';
import { scan, stale, type Allowlist } from './source-scan.test-helper';

/**
 * Text is never faded with an alpha (#1522). `muted` and `muted-dim` are the
 * two steps of the text ramp and both clear 4.5:1 on both surfaces in every
 * theme — palette.test.ts holds them there. An alpha utility composites over
 * the surface instead, which routes straight around that gate: `text-muted/70`
 * lands at 3.3:1, `text-muted/45` at 2.0:1 and `text-muted/40` at 1.8:1 in the
 * cave, all of it 10–14 px body text where the 3:1 large-text allowance never
 * applies. A hundred and twenty call sites had drifted down that ramp, four
 * of them in the day before it was measured, so the floor is a test and not
 * a habit.
 *
 * `text-ink` keeps its alphas from /60 up — measured worst 4.67:1, against
 * 3.97:1 at /55 — because those are the *bright* end of the hierarchy and
 * still legible. Backgrounds, borders and rings are untouched: an alpha is
 * the right tool for an edge, and no one reads a border.
 */

/** A rule that has to bend goes here, with the reason and its measured ratio. */
const ALLOWLIST: Allowlist = {};

/** The ramp is two tokens now; an alpha on either is a dim step nobody gated. */
const FADED_MUTED = /\btext-muted(?:-dim)?\/\d+\b/g;
/** Below /60 ink drops under 4.5:1 on the lightest surfaces in the catalogue. */
const FADED_INK = /\btext-ink\/(?:\d|[1-5]\d)\b/g;

const help = (offenders: string[]) =>
	`Text faded below 4.5:1 (#1522):\n${offenders.join('\n')}\n` +
	'Use `text-muted` or `text-muted-dim` — the two gated steps of the text ' +
	'ramp — rather than an alpha over the surface. Icons and borders can stay ' +
	'on alphas; if one of these really has to, add it to ALLOWLIST in ' +
	'no-faded-text.test.ts with its measured ratio.';

describe('the text ramp stays legible (#1522)', () => {
	it('fades no muted text with an alpha', () => {
		const { offenders } = scan(FADED_MUTED, ALLOWLIST);
		expect(offenders, help(offenders)).toEqual([]);
	});

	it('keeps ink alphas at the legible end of the ramp', () => {
		const { offenders } = scan(FADED_INK, ALLOWLIST);
		expect(offenders, help(offenders)).toEqual([]);
	});

	it('keeps no allowlist entry that excuses nothing', () => {
		const used = new Set([
			...scan(FADED_MUTED, ALLOWLIST).used,
			...scan(FADED_INK, ALLOWLIST).used,
		]);
		const dead = stale(ALLOWLIST, used);
		expect(
			dead,
			`ALLOWLIST entries with nothing left to excuse — delete them:\n  ${dead.join('\n  ')}`,
		).toEqual([]);
	});
});
