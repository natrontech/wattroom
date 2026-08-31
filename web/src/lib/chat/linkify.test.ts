import { describe, expect, it } from 'vitest';
import { linkify } from './linkify';

describe('linkify', () => {
	it('splits a URL out of its sentence without eating the punctuation', () => {
		expect(linkify('go to https://a.b/c, now', '')).toEqual([
			{ text: 'go to ' },
			{ text: 'https://a.b/c', href: 'https://a.b/c', external: true },
			{ text: ', now' },
		]);
	});

	it('keeps same-origin links inside the SPA', () => {
		expect(linkify('https://wattroom.cc/r/ftp', 'https://wattroom.cc')).toEqual(
			[{ text: 'https://wattroom.cc/r/ftp', href: '/r/ftp', external: false }],
		);
	});

	it('leaves non-http schemes as text', () => {
		const parts = linkify('javascript:alert(1) and mailto:a@b.c', '');
		expect(parts).toEqual([{ text: 'javascript:alert(1) and mailto:a@b.c' }]);
	});
});
