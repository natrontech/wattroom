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
	'routes/dev/':
		'dev-only galleries: browser chrome and fake video frames, drawn in the colours the real thing has',
	'lib/brand/icons.ts': "Google's mark — provider colours never follow a theme",
	'lib/room/Stage.svelte':
		'the letterbox behind video is black on every palette',
	'lib/room/JukeboxDock.svelte':
		'the YouTube tile and its failure scrim sit on black, like the player itself',
	'lib/brand/LandingHero.svelte':
		'the fake camera feeds: the meter track is a scrim over "video", dark like the real ones',
	'lib/components/Avatar.svelte':
		'the level chip is white on the neon fill in both families',
};

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
/** Anchors, ids and url() start with `#` too; none of them is a colour. */
const NOT_A_COLOUR = /(?:href|id)=["']$|url\(["']?$/;
const ABSOLUTE = /\b(?:text|bg|border|ring|fill|stroke)-(?:white|black)\b/g;

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

	it('keeps no allowlist entry that excuses nothing', () => {
		const used = new Set([
			...scan(HEX, ALLOWLIST, NOT_A_COLOUR).used,
			...scan(ABSOLUTE, ALLOWLIST).used,
		]);
		const dead = stale(ALLOWLIST, used);
		expect(
			dead,
			`ALLOWLIST entries with nothing left to excuse — delete them:\n  ${dead.join('\n  ')}`,
		).toEqual([]);
	});
});
