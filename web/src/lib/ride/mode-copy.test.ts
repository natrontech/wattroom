// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { gearsNews } from './gears-news';
import { DONT_SHIFT_SETTING, GEARS_NEWS_LINE } from './mode-copy';

// Pinned (#3203, #3333): Settings › Equipment's words, and the one line a
// rider who kept them hears when gears come.
describe('what the free ride says', () => {
	beforeEach(() => localStorage.clear());

	it('names the setting by what it does', () => {
		expect(DONT_SHIFT_SETTING).toEqual({
			label: "Don't make me shift",
			hint: 'WattRoom holds watts wherever it would put you on a slope.',
		});
	});

	it('tells a rider on "Don\'t make me shift" that gears exist, once', () => {
		expect(GEARS_NEWS_LINE).toBe(
			'Virtual gears are here: pick Grade to shift.',
		);
		expect(gearsNews(false)).toBeUndefined();
		expect(gearsNews(true)).toBe(GEARS_NEWS_LINE);
		expect(gearsNews(true)).toBeUndefined();
	});
});
