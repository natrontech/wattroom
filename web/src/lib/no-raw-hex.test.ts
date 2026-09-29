import { describe, expect, it } from 'vitest';
import { scan, stale, type Allowlist } from './source-scan.test-helper';

/**
 * Nothing paints a raw colour outside the token layer (#400). A theme owns
 * every colour, so a hex literal or a `bg-black` in a component is a spot the
 * rider's palette cannot reach. Below is every place a fixed colour is the
 * point, each with its reason — before adding a line, ask whether a token
 * (`text-ink`, `bg-paper`, `var(--color-surface)`) is what was meant.
 */
const ALLOWLIST: Allowlist = {
	'app.css':
		'the token layer — every colour is defined here, as a light-dark() pair',
	'lib/themes.ts':
		'the token layer — Outrun pins the exact values that shipped',
	'*.test.ts': 'fixtures',
	'routes/(app)/dev/':
		'dev-only galleries: browser chrome and fake video frames, drawn in the colours the real thing has',
	'lib/brand/icons.ts': "Google's mark — provider colours never follow a theme",
	'lib/channel/Stage.svelte':
		'the letterbox behind video is black on every palette',
	'lib/channel/JukeboxDock.svelte':
		'the YouTube tile and its failure scrim sit on black, like the player itself',
	'lib/brand/LandingHero.svelte':
		'the fake camera feeds: stand-ins drawn from each rider\'s hue, and a meter scrim over "video", dark like the real ones',
	'lib/brand/ClayRider.svelte':
		"the landing's clay cyclist: jersey, helmet and skin are the drawing's own colours, derived from its hue, and the spokes a white glint",
	'lib/channel/RiderTile.svelte':
		"a rider's hue is who they are on every palette (#181): the camera stand-in is drawn from it, the camera-off wash mixes it into the surface token",
	'lib/components/MedalCard.svelte':
		"the sun's slice mask: in an SVG mask white shows and black cuts — luminance, never paint",
};

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
/** Anchors, ids and url() start with `#` too; none of them is a colour. */
const NOT_A_COLOUR = /(?:href|id)=["']$|url\(["']?$/;
const ABSOLUTE = /\b(?:text|bg|border|ring|fill|stroke)-(?:white|black)\b/g;

/**
 * A colour function is a raw colour as surely as a hex is, and `hsl()` and
 * `rgba()` walked straight past the rule above (#2888). `color-mix()` over
 * tokens stays legal: it is how a tint of a token is written.
 */
const FUNCTION = /\b(?:rgba?|hsla?|hwb|(?:ok)?l(?:ab|ch))\(/g;

/** Values a paint may take that are not a colour. */
const KEYWORD =
	'none|transparent|currentcolor|inherit|initial|unset|revert|context-fill|context-stroke';
/** Attributes, style directives and CSS properties that take a paint. */
const PAINT = '[a-z-]*color|fill|stroke|background';
/**
 * A bare lowercase word as a paint is a named colour — `fill="white"`,
 * `style:color="red"`, `stroke: black;`. An expression would sit in `{}`, a
 * token in `var()`, and `currentColor` is camel-cased. `string` is the
 * TypeScript annotation `fill: string;`, not a value.
 */
const NAMED = new RegExp(
	`\\b(?:${PAINT})=["'](?!(?:${KEYWORD})["'])[a-z]+["']` +
		`|(?:^|[\\s;{"'])(?:${PAINT})\\s*:\\s*(?!(?:${KEYWORD}|string)\\b)[a-z]+\\s*[;"']`,
	'g',
);

const help = (what: string, offenders: string[]) =>
	`${what} outside the token layer (#400):\n${offenders.join('\n')}\n` +
	'Use a theme token (text-ink, bg-paper, var(--color-surface), …) — or, when a ' +
	'fixed colour is the point, add the file to ALLOWLIST in no-raw-hex.test.ts with its reason.';

describe('the token layer owns every colour (#400)', () => {
	it('paints no raw hex outside it', () => {
		const { offenders } = scan(HEX, ALLOWLIST, NOT_A_COLOUR);
		expect(offenders, help('Raw hex', offenders)).toEqual([]);
	});

	it('says ink and paper, never white and black', () => {
		const { offenders } = scan(ABSOLUTE, ALLOWLIST);
		expect(
			offenders,
			help('Absolute white/black utilities', offenders),
		).toEqual([]);
	});

	it('paints no colour function outside it', () => {
		const { offenders } = scan(FUNCTION, ALLOWLIST);
		expect(offenders, help('Colour functions', offenders)).toEqual([]);
	});

	it('names no colour outside it', () => {
		const { offenders } = scan(NAMED, ALLOWLIST);
		expect(offenders, help('Named colours', offenders)).toEqual([]);
	});

	it('keeps no allowlist entry that excuses nothing', () => {
		const used = new Set([
			...scan(HEX, ALLOWLIST, NOT_A_COLOUR).used,
			...scan(ABSOLUTE, ALLOWLIST).used,
			...scan(FUNCTION, ALLOWLIST).used,
			...scan(NAMED, ALLOWLIST).used,
		]);
		const dead = stale(ALLOWLIST, used);
		expect(
			dead,
			`ALLOWLIST entries with nothing left to excuse — delete them:\n  ${dead.join('\n  ')}`,
		).toEqual([]);
	});
});
