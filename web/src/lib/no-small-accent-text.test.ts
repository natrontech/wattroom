import { describe, expect, it } from 'vitest';
import { scan, stale, type Allowlist } from './source-scan.test-helper';

/**
 * The accents never colour small words (#1965, #2858). palette.ts gates
 * `watt` and `neon` at 3:1 — a graphic's floor and large text's — on the
 * promise that they are for the giant watt number and for marks, and a
 * 10–14 px word needs 4.5:1 (ADR-0023 §3). The first fix went site by site
 * and added no guard; within weeks "Start a session" read 3.6:1 in the light
 * themes and the sidebar's update row printed neon words at 3.5:1. So the
 * promise is a test: an accent text colour on the same class list as a small
 * size is refused. Put the accent on the icon, the border or the tint, and
 * the word in ink or muted.
 */

/** A rule that has to bend goes here, with the reason and its measured ratio. */
const ALLOWLIST: Allowlist = {};

const SMALL_ACCENT_TEXT =
	/^(?=.*(?:\btext-(?:xs|sm)\b|\btext-\[(?:9|1[0-3])px\]|\beyebrow\b)).*?\btext-(?:watt|neon)(?:\/\d+)?(?![\w-])/g;

const help = (offenders: string[]) =>
	`Small words in an accent colour, gated only at 3:1 (#2858):\n${offenders.join('\n')}\n` +
	'Give the word `text-ink` or `text-muted` and keep the accent on its icon, ' +
	'border or tint. If one really has to stay, add it to ALLOWLIST in ' +
	'no-small-accent-text.test.ts with its measured ratio in every theme.';

describe('the accents stay off small words (#1965, #2858)', () => {
	it('colours no small word in watt or neon', () => {
		const { offenders } = scan(SMALL_ACCENT_TEXT, ALLOWLIST);
		expect(offenders, help(offenders)).toEqual([]);
	});

	it('keeps no allowlist entry that excuses nothing', () => {
		const dead = stale(ALLOWLIST, scan(SMALL_ACCENT_TEXT, ALLOWLIST).used);
		expect(dead).toEqual([]);
	});
});
