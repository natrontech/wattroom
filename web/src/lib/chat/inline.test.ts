import { describe, expect, it } from 'vitest';
import { parseInline } from './inline';

describe('parseInline links', () => {
	it('splits a URL out of its sentence without eating the punctuation', () => {
		expect(parseInline('go to https://a.b/c, now', '')).toEqual([
			{ text: 'go to ' },
			{ text: 'https://a.b/c', href: 'https://a.b/c', external: true },
			{ text: ', now' },
		]);
	});

	it('keeps same-origin links inside the SPA', () => {
		expect(
			parseInline('https://wattroom.cc/r/ftp', 'https://wattroom.cc'),
		).toEqual([
			{ text: 'https://wattroom.cc/r/ftp', href: '/r/ftp', external: false },
		]);
	});

	it('leaves non-http schemes as text', () => {
		expect(parseInline('javascript:alert(1) and mailto:a@b.c', '')).toEqual([
			{ text: 'javascript:alert(1) and mailto:a@b.c' },
		]);
	});

	it("doesn't read underscores inside a URL as emphasis", () => {
		const parts = parseInline('https://a.b/x_y_z ok', '');
		expect(parts[0].href).toBe('https://a.b/x_y_z');
		expect(parts.some((part) => part.italic)).toBe(false);
	});
});

describe('parseInline marks', () => {
	it('marks bold, italic, strike and code', () => {
		expect(parseInline('**hard** *easy* ~~out~~ `220w`', '')).toEqual([
			{ text: 'hard', bold: true },
			{ text: ' ' },
			{ text: 'easy', italic: true },
			{ text: ' ' },
			{ text: 'out', strike: true },
			{ text: ' ' },
			{ text: '220w', code: true },
		]);
	});

	it('takes code literally', () => {
		expect(parseInline('`**not bold** https://a.b`', '')).toEqual([
			{ text: '**not bold** https://a.b', code: true },
		]);
	});

	it('leaves snake_case and lone delimiters alone', () => {
		expect(parseInline('ftp_test_value 5 * 3 * 2', '')).toEqual([
			{ text: 'ftp_test_value 5 * 3 * 2' },
		]);
	});
});
