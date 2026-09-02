import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nothing paints a raw colour outside the token layer (#400). A theme owns
 * every colour, so a hex literal or a `bg-black` in a component is a spot the
 * rider's palette cannot reach. Below is every place a fixed colour is the
 * point, each with its reason — before adding a line, ask whether a token
 * (`text-ink`, `bg-paper`, `var(--color-surface)`) is what was meant.
 *
 * Keys are relative to `src`: an exact file, a `dir/` prefix, or `*.suffix`.
 */
const ALLOWLIST: Record<string, string> = {
	'app.css':
		'the token layer — every colour is defined here, as a light-dark() pair',
	'lib/themes.ts':
		'the token layer — Outrun pins the exact values that shipped',
	'*.test.ts': 'fixtures',
	'routes/dev/':
		'dev-only galleries: browser chrome and fake video frames, drawn in the colours the real thing has',
	'lib/brand/icons.ts': "Google's mark — provider colours never follow a theme",
	'routes/login/+page.svelte': "Strava's brand orange on the connect button",
	'lib/room/Stage.svelte':
		'the letterbox behind video is black on every palette',
	'lib/room/JukeboxDock.svelte':
		'the YouTube tile and its failure scrim sit on black, like the player itself',
	'lib/brand/LandingHero.svelte':
		'the fake camera feeds: the meter track is a scrim over "video", dark like the real ones',
	'lib/components/Avatar.svelte':
		'the level chip is white on the neon fill in both families',
};

const SRC = join(import.meta.dirname, '..');
const FILES = readdirSync(SRC, { recursive: true })
	.map(String)
	.filter((file) => /\.(svelte|ts|css)$/.test(file));

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
/** Anchors, ids and url() start with `#` too; none of them is a colour. */
const NOT_A_COLOUR = /(?:href|id)=["']$|url\(["']?$/;
const ABSOLUTE = /\b(?:text|bg|border|ring|fill|stroke)-(?:white|black)\b/g;

/** Blank comments, keeping newlines: `#280` in a comment is an issue, not a colour. */
function code(source: string): string {
	return source.replace(
		/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(?<=^|\s)\/\/.*$/gm,
		(comment) => comment.replace(/[^\n]/g, ' '),
	);
}

function allowedBy(file: string): string | undefined {
	return Object.keys(ALLOWLIST).find((rule) =>
		rule.startsWith('*')
			? file.endsWith(rule.slice(1))
			: rule.endsWith('/')
				? file.startsWith(rule)
				: file === rule,
	);
}

/** Every match of `pattern` in `src`, split into offenders and the rules that excused the rest. */
function scan(pattern: RegExp, skip?: RegExp) {
	const offenders: string[] = [];
	const used = new Set<string>();
	for (const file of FILES) {
		const rule = allowedBy(file);
		code(readFileSync(join(SRC, file), 'utf8'))
			.split('\n')
			.forEach((line, i) => {
				for (const m of line.matchAll(pattern)) {
					if (skip?.test(line.slice(0, m.index))) continue;
					if (rule) used.add(rule);
					else offenders.push(`  ${file}:${i + 1}  ${m[0]}`);
				}
			});
	}
	return { offenders, used };
}

const help = (what: string, offenders: string[]) =>
	`${what} outside the token layer (#400):\n${offenders.join('\n')}\n` +
	'Use a theme token (text-ink, bg-paper, var(--color-surface), …) — or, when a ' +
	'fixed colour is the point, add the file to ALLOWLIST in no-raw-hex.test.ts with its reason.';

describe('the token layer owns every colour (#400)', () => {
	it('paints no raw hex outside it', () => {
		const { offenders } = scan(HEX, NOT_A_COLOUR);
		expect(offenders, help('Raw hex', offenders)).toEqual([]);
	});

	it('says ink and paper, never white and black', () => {
		const { offenders } = scan(ABSOLUTE);
		expect(
			offenders,
			help('Absolute white/black utilities', offenders),
		).toEqual([]);
	});

	it('keeps no allowlist entry that excuses nothing', () => {
		const used = new Set([
			...scan(HEX, NOT_A_COLOUR).used,
			...scan(ABSOLUTE).used,
		]);
		const stale = Object.keys(ALLOWLIST).filter((rule) => !used.has(rule));
		expect(
			stale,
			`ALLOWLIST entries with nothing left to excuse — delete them:\n  ${stale.join('\n  ')}`,
		).toEqual([]);
	});
});
