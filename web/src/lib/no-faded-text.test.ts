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

/**
 * Whole-element opacity fades text exactly as an alpha utility does, and the
 * two rules above never saw it (#2888): a locked badge's card read 3.1:1, an
 * away name 2.6:1, an offline initial 2.2:1. So an unprefixed `opacity-NN`
 * (or `class:opacity-NN`) is text until a file says why it is not. A variant
 * — `hover:`, `disabled:`, `group-hover:` — is a state, not a resting fade,
 * and passes; so do `opacity-0` and `opacity-100`.
 */
const OPACITY: Allowlist = {
	'routes/(app)/dev/': 'dev-only galleries',
	'lib/nav/VoiceOccupants.svelte':
		'the rider being dragged or in flight between channels — transient feedback on a move in progress',
	'routes/(app)/workouts/edit/StepList.svelte':
		'the step being dragged — transient feedback on a move in progress',
	'routes/(app)/crew/[id]/settings/CrewChannels.svelte':
		'the channel being dragged — transient feedback on a move in progress',
	'lib/board/BoardFace.svelte':
		'a pad being dragged, or cooling down and aria-disabled — WCAG 1.4.3 exempts an inactive control',
	'lib/components/Avatar.svelte':
		'an offline picture — an image, not text; the initial takes muted-dim instead',
	'lib/components/IntervalGraph.svelte':
		'SVG blocks and reference lines — no text',
	'lib/components/FitnessChart.svelte': 'chart strokes and bands — no text',
	'lib/components/FtpTrendChart.svelte': 'chart strokes and bands — no text',
	'lib/components/PowerCurveChart.svelte': 'chart strokes and bands — no text',
	'lib/ride/SessionSummary.svelte': "the trace's dashed FTP line — no text",
	'lib/board/Soundboard.svelte': 'the grip glyph',
	'lib/channel/Stage.svelte': 'the grip glyph',
	'lib/channel/EventLine.svelte': "the line's mark glyph",
	'lib/components/ContextMenuHost.svelte': "a menu item's icon",
	'routes/(app)/messages/+page.svelte': "the empty state's icon",
	'lib/channel/JukeboxDeck.svelte': 'cover art under a scrim — an image',
	'lib/channel/JukeboxRail.svelte': 'cover art under a scrim — an image',
	'lib/components/PalettePicker.svelte': "a swatch's accent bar",
	'routes/(site)/+page.svelte': 'the background gridlines',
	'routes/+error.svelte': 'the background gridlines',
	'routes/(app)/login/+page.svelte': 'the background gridlines',
	'routes/(app)/login/recover/+page.svelte': 'the background gridlines',
	'routes/(app)/(legal)/+layout.svelte': 'the background gridlines',
};

/** A resting fade: not after a variant's colon, not part of another word. */
const FADED_OPACITY =
	/\bclass:opacity-[1-9]\d?\b|(?<![\w:-])opacity-[1-9]\d?\b/g;

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

	it('fades no text with opacity', () => {
		const { offenders } = scan(FADED_OPACITY, OPACITY);
		expect(
			offenders,
			`Opacity on text (#2888):\n${offenders.join('\n')}\n` +
				'Draw the words in `text-muted` or `text-muted-dim` and let a glyph ' +
				'carry the state (a lock, the away mark). If what fades is not text ' +
				'— an icon, an image, a chart stroke — add the file to OPACITY in ' +
				'no-faded-text.test.ts with the reason.',
		).toEqual([]);
	});

	it('keeps no allowlist entry that excuses nothing', () => {
		const used = new Set([
			...scan(FADED_MUTED, ALLOWLIST).used,
			...scan(FADED_INK, ALLOWLIST).used,
		]);
		const dead = [
			...stale(ALLOWLIST, used),
			...stale(OPACITY, scan(FADED_OPACITY, OPACITY).used),
		];
		expect(
			dead,
			`ALLOWLIST entries with nothing left to excuse — delete them:\n  ${dead.join('\n  ')}`,
		).toEqual([]);
	});
});
