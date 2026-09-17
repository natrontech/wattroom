/**
 * What /dev/themes lays out (#399). The catalogue derived four identities to
 * satisfy the contrast gate and nobody has looked at them; the gate says
 * legible, only a person can say whether it is any good. So the page renders
 * every theme for real, against the same surfaces in the same order.
 *
 * Pure, and separate from the page, for the one thing worth testing here: a
 * gallery that silently drops a theme is worse than no gallery, and a theme
 * added to THEMES later is exactly how that happens.
 */
import { ZONES, worst, worstLc } from '$lib/gate';
import {
	CONTRAST,
	type Theme,
	type ThemeFamily,
	type TokenName,
} from '$lib/palette';
import { THEMES } from '$lib/themes';

/**
 * Which of the two jobs a family member does. A ride resolves the dark member
 * whatever the scheme says (ADR-0005, amended in #113), so the dark half of an
 * identity IS the cave; the white half only ever renders on a desk.
 */
export type Surface = 'cave' | 'desk';

const SURFACE_OF: Record<ThemeFamily, Surface> = {
	dark: 'cave',
	white: 'desk',
};

export interface GalleryPanel {
	theme: Theme;
	surface: Surface;
}

/** One identity, its family members side by side. */
export interface GalleryRow {
	identity: string;
	panels: GalleryPanel[];
}

/**
 * Every theme, grouped by identity in catalogue order — the ordering the
 * picker offers them in, so a judgement here transfers to the screen a rider
 * actually chooses from. Grouping rather than filtering by family is what
 * makes the row complete: an identity that ever gains a third member shows it
 * instead of dropping it.
 */
export const GALLERY_ROWS: GalleryRow[] = THEMES.reduce<GalleryRow[]>(
	(rows, theme) => {
		const panel: GalleryPanel = { theme, surface: SURFACE_OF[theme.family] };
		const row = rows.find((r) => r.identity === theme.identity);
		if (row) row.panels.push(panel);
		else rows.push({ identity: theme.identity, panels: [panel] });
		return rows;
	},
	[],
	// Cave first in every row: the ride is the surface the palette was
	// designed against, and comparing two identities means comparing the
	// same column.
).map((row) => ({
	...row,
	panels: [...row.panels].sort((a, b) =>
		a.surface === b.surface ? 0 : a.surface === 'cave' ? -1 : 1,
	),
}));

/** Flattened, in the order the page draws them. */
export const GALLERY_THEMES: Theme[] = GALLERY_ROWS.flatMap((row) =>
	row.panels.map((panel) => panel.theme),
);

export interface Reading {
	token: TokenName;
	/** What the token is for, in the vocabulary the ADR uses. */
	job: string;
	ratio: number;
	floor: number;
	passes: boolean;
	/** APCA Lc for the same pair — reported, never gated (ADR-0023 §3, #621). */
	lc: number;
}

const GATED: { token: TokenName; job: string; floor: number }[] = [
	{ token: 'ink', job: 'body text', floor: CONTRAST.text },
	{ token: 'muted', job: 'secondary text', floor: CONTRAST.text },
	{ token: 'watt', job: 'live data', floor: CONTRAST.accent },
	{ token: 'neon', job: 'chrome', floor: CONTRAST.accent },
	{ token: 'danger', job: 'destructive', floor: CONTRAST.accent },
];

/**
 * The build contract's numbers, next to the thing they claim to be about.
 * Zones are deliberately absent: their floor is relative to Outrun's own ramp
 * rather than a constant (ADR-0023 §3), so the ramp reports per-swatch ratios
 * beside the swatches instead of a pass mark that would need its own essay.
 *
 * `lc` rides along on every one of them. It decides nothing — the pass mark is
 * still WCAG's — but the page is where a person judges a palette, and the
 * absolute APCA number is the thing the reference-scaled floors cannot show.
 */
export function readings(theme: Theme): Reading[] {
	return GATED.map(({ token, job, floor }) => {
		const ratio = worst(theme, token);
		return {
			token,
			job,
			floor,
			ratio,
			passes: ratio >= floor,
			lc: worstLc(theme, token),
		};
	});
}

/** The gate's own list, not a second copy — one ramp, one spelling of it. */
export { ZONES };

export interface RampReading {
	ratio: number;
	lc: number;
}

/**
 * Each zone's worst WCAG ratio and APCA Lc against the theme's surfaces,
 * Z1 → Z7. Both, because the ramp is where the two measures disagree about
 * what the per-family scaling has been hiding (#621).
 */
export function rampReadings(theme: Theme): RampReading[] {
	return ZONES.map((zone) => ({
		ratio: worst(theme, zone),
		lc: worstLc(theme, zone),
	}));
}
