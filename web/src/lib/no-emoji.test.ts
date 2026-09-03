import { describe, expect, it } from 'vitest';
import { scan, stale, type Allowlist } from './source-scan.test-helper';

/**
 * The UI draws icons, never emoji (#447, #458). An emoji is a font the rider
 * did not choose: it lands a different shape on every platform, ignores the
 * theme, and cannot be sized against the text beside it — so every mark the
 * app draws is a lucide icon. Comments are exempt (the scanner blanks them);
 * prose about the ⚑ may keep the glyph.
 *
 * Keys are relative to `src`: an exact file, a `dir/` prefix, or `*.suffix`.
 */
const ALLOWLIST: Allowlist = {
	'lib/icons.ts':
		'the emoji-to-icon map: values rooms saved before #447, translated on read — data, not chrome',
	'*.test.ts': 'fixtures, including the ones that prove the map above works',
	'routes/dev/room/mockRoom.svelte.ts':
		'mock chat: a rider typing an emoji into a message is content, like their words',
};

/**
 * Pictographs, plus the two symbol blocks emoji are drawn from — the flag and
 * heart-suit glyphs live there, and neither is Extended_Pictographic. Arrows
 * and typographic marks (→, ·, —, ≤) are text, and stay text.
 */
const EMOJI = /[\u2600-\u27bf\u2b00-\u2bff\p{Extended_Pictographic}]/gu;

describe('the UI draws icons, not emoji (#458)', () => {
	it('leaves no emoji in src', () => {
		const { offenders } = scan(EMOJI, ALLOWLIST);
		expect(
			offenders,
			`Emoji in the UI:\n${offenders.join('\n')}\n` +
				'Draw a lucide icon instead — import it from @lucide/svelte and give it ' +
				'a size that matches its neighbours, plus an aria-label when the icon is ' +
				'the only label. Stored or typed emoji that are data, not chrome, go in ' +
				'ALLOWLIST in no-emoji.test.ts with their reason.',
		).toEqual([]);
	});

	it('keeps no allowlist entry that excuses nothing', () => {
		const dead = stale(ALLOWLIST, scan(EMOJI, ALLOWLIST).used);
		expect(
			dead,
			`ALLOWLIST entries with nothing left to excuse — delete them:\n  ${dead.join('\n  ')}`,
		).toEqual([]);
	});
});
