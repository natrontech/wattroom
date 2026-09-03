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
import { contrast } from '$lib/color';
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

export const SURFACE_OF: Record<ThemeFamily, Surface> = {
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
}

/** The worst this token scores against either of the theme's own surfaces. */
export function worstContrast(theme: Theme, token: TokenName): number {
	return Math.min(
		contrast(theme.tokens[token], theme.tokens.surface),
		contrast(theme.tokens[token], theme.tokens['surface-raised']),
	);
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
 */
export function readings(theme: Theme): Reading[] {
	return GATED.map(({ token, job, floor }) => {
		const ratio = worstContrast(theme, token);
		return { token, job, floor, ratio, passes: ratio >= floor };
	});
}

export const ZONES: TokenName[] = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'];

/** Each zone's worst ratio against the theme's surfaces, Z1 → Z7. */
export function rampReadings(theme: Theme): number[] {
	return ZONES.map((zone) => worstContrast(theme, zone));
}
