import { describe, expect, it } from 'vitest';
import { isLink, parsePin } from './pins.svelte';

/**
 * The parser is the whole of the "more than a key and a value" decision
 * (#2405): a pin is one textarea, and this is what decides which of its lines
 * a rider can tap to copy. Getting it wrong is quiet — a field that reads as
 * prose simply has no copy button, and nobody reports a button that was never
 * there — so the cases live here rather than in someone's head.
 */
describe('parsePin', () => {
	it('makes a copyable field of `Label: value`', () => {
		expect(parsePin('Address: mc.natron.io:25565')).toEqual([
			{ kind: 'field', label: 'Address', value: 'mc.natron.io:25565' },
		]);
	});

	// The colon in a time is the reason the space after the colon is required.
	it('leaves a sentence containing a colon as prose', () => {
		expect(parsePin('We usually start at 20:00')).toEqual([
			{ kind: 'text', text: 'We usually start at 20:00' },
		]);
	});

	it('keeps a time as the value of a real field', () => {
		expect(parsePin('Start: 20:00')).toEqual([
			{ kind: 'field', label: 'Start', value: '20:00' },
		]);
	});

	// `https://…` has no space after its colon, so the same rule covers it.
	it('reads a bare link as a field with no label', () => {
		expect(parsePin('https://discord.gg/wattroom')).toEqual([
			{ kind: 'field', label: '', value: 'https://discord.gg/wattroom' },
		]);
	});

	it('keeps a labelled link labelled', () => {
		expect(parsePin('Invite: https://discord.gg/wattroom')).toEqual([
			{ kind: 'field', label: 'Invite', value: 'https://discord.gg/wattroom' },
		]);
	});

	// A whole sentence before a colon is prose, not a label: the 32-character
	// ceiling is what stops "As discussed last week the code is: 4417" from
	// becoming a field with a paragraph for a name.
	it('refuses a label longer than a label', () => {
		const long = `${'x'.repeat(33)}: 4417`;
		expect(parsePin(long)).toEqual([{ kind: 'text', text: long }]);
	});

	it('drops blank lines and keeps the order of what is left', () => {
		expect(parsePin('Door code: 4417\n\n\nShut the roller door.')).toEqual([
			{ kind: 'field', label: 'Door code', value: '4417' },
			{ kind: 'text', text: 'Shut the roller door.' },
		]);
	});

	it('has nothing to show for an empty body', () => {
		expect(parsePin('')).toEqual([]);
		expect(parsePin('\n  \n')).toEqual([]);
	});
});

describe('isLink', () => {
	it('knows a link from a server address', () => {
		expect(isLink('https://discord.gg/x')).toBe(true);
		expect(isLink('  http://example.org  ')).toBe(true);
		expect(isLink('mc.natron.io:25565')).toBe(false);
		expect(isLink('kilojoule-hammer-42')).toBe(false);
	});
});
