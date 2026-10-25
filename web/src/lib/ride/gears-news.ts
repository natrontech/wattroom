import { GEARS_NEWS_LINE } from '$lib/ride/mode-copy';

const SEEN = 'wattroom.gears-news.v1';

/**
 * The line that says gears exist, once per device, to a rider on "Don't
 * make me shift" (#3333): the setting kept them in watts when gears came.
 * Nothing when storage is out of reach, since a line every ride is worse
 * than none.
 */
export function gearsNews(dontShift: boolean): string | undefined {
	if (!dontShift) return undefined;
	try {
		if (localStorage.getItem(SEEN)) return undefined;
		localStorage.setItem(SEEN, '1');
		return GEARS_NEWS_LINE;
	} catch {
		return undefined;
	}
}
