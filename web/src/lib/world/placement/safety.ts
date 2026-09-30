import { hexToOklch, hueDistance } from '$lib/color';
import { themesFor } from '$lib/themes';
import catalogue from '$lib/wardrobe/catalogue.json';

/**
 * O13, what may not stand in the world (#3221): words no banner carries and
 * colours no object wears, read from the guard the wardrobe's catalogue test
 * and the studio's gate already share (#3256), so the world refuses exactly
 * what they refuse.
 */

const guard = catalogue.guard;

/** A real brand or event, or the Swiss cross or a canton's arms: whole words, any case. */
const REFUSED = [
	...guard.blockedWords,
	...guard.motifs.crossWords,
	...guard.motifs.shieldWords,
];

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (w: string) =>
	new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}($|[^\\p{L}\\p{N}])`, 'iu');
const PATTERNS = REFUSED.map((w) => [w, wholeWord(w)] as const);

/** What a banner's words may not say: the refused words it carries, none when it may. */
export function bannerRefusals(text: string): string[] {
	return PATTERNS.filter(([, re]) => re.test(text)).map(([w]) => w);
}

/** The watt of every dark identity a rider may pick (themes.ts): what marks live data, never scenery (ADR-0005, ADR-0072). */
export const WATT_HUES = themesFor('dark').map(
	(t) => hexToOklch(t.tokens.watt).h,
);

/** Whether a colour reads as live data: within the guard's hue band of any identity's watt, and chromatic enough to glow. */
export function inWattBand(hex: string): boolean {
	const c = hexToOklch(hex);
	return (
		c.c > guard.wattChromaMax &&
		WATT_HUES.some((h) => hueDistance(c.h, h) < guard.wattHueBandDeg)
	);
}
