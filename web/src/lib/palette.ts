/**
 * Accent palettes (#292). ADR-0005 gives the two accents different jobs:
 * `--color-watt` marks live data and is the only thing that glows, and
 * `--color-neon` is structural chrome that never does. A palette therefore
 * picks a *pair*, never a single colour, and every path here keeps the two
 * hues far enough apart that a glowing number cannot read as chrome.
 *
 * Pure on purpose — the DOM and the rider's choice live in palette.svelte.ts,
 * so the colour rules stay testable without a browser.
 */

/** Both sides of a light-dark() token — the shape app.css already uses. */
export interface AccentPair {
	light: string;
	dark: string;
}

export interface Palette {
	id: string;
	name: string;
	/** One line under the name: what this palette is for. */
	note: string;
	watt: AccentPair;
	neon: AccentPair;
}

export const DEFAULT_ID = 'outrun';
export const CUSTOM_ID = 'custom';

/**
 * Degrees the neon hue sits behind the watt hue. Measured off the shipped
 * tokens in app.css, where the pair is 65° apart — that gap is what keeps
 * chrome reading as chrome, so a custom palette inherits it instead of
 * letting a rider collapse both accents onto one hue.
 */
export const HUE_SEPARATION = 65;

/** The narrowest separation any palette may ship with. */
export const MIN_HUE_SEPARATION = 40;

/**
 * Lightness and chroma measured off the shipped Outrun pair, so a custom
 * palette lands with its legibility profile rather than a guessed one: hue is
 * the only variable a rider moves.
 */
const CUSTOM_LCH = {
	wattLight: [0.611, 0.23],
	wattDark: [0.673, 0.233],
	neonLight: [0.475, 0.243],
	neonDark: [0.56, 0.277],
} as const;

/**
 * ADR-0005 records that Outrun won over Tron Ice, Miami Nights and Laser
 * Yellow by rendering all four against the same mocks — it did not record the
 * losing values. Outrun below is the shipped token set, unchanged. The other
 * three are reconstructions: hues picked to match their names, lightness and
 * chroma solved so each accent stays inside sRGB and clears 3.5:1 against its
 * own surface. They deserve a design pass against real mocks before anyone
 * calls them final.
 */
export const PRESETS: Palette[] = [
	{
		id: DEFAULT_ID,
		name: 'Outrun',
		note: 'The shipped identity — magenta data on violet chrome.',
		watt: { light: '#e6247d', dark: '#ff3d8b' },
		neon: { light: '#6f1ad1', dark: '#8b2bff' },
	},
	{
		id: 'tron-ice',
		name: 'Tron Ice',
		note: 'The colder fallback ADR-0005 names, for long sessions.',
		watt: { light: '#00858d', dark: '#00bcc5' },
		neon: { light: '#224dca', dark: '#3968e8' },
	},
	{
		id: 'miami-nights',
		name: 'Miami Nights',
		note: 'Coral over teal — the furthest thing here from Outrun.',
		watt: { light: '#e63651', dark: '#fc4e63' },
		neon: { light: '#007475', dark: '#009494' },
	},
	{
		id: 'laser-yellow',
		name: 'Laser Yellow',
		note: 'The original watt-yellow, kept over violet chrome.',
		watt: { light: '#a07a00', dark: '#ebcf00' },
		neon: { light: '#6f1ad1', dark: '#8b2bff' },
	},
];

/** Wrap any angle into [0, 360). */
export function normalizeHue(hue: number): number {
	return ((hue % 360) + 360) % 360;
}

/** Shortest angular distance between two hues, 0–180. */
export function hueDistance(a: number, b: number): number {
	const d = Math.abs(normalizeHue(a) - normalizeHue(b));
	return d > 180 ? 360 - d : d;
}

function oklch(lc: readonly [number, number], hue: number): string {
	return `oklch(${lc[0]} ${lc[1]} ${normalizeHue(hue).toFixed(1)})`;
}

/**
 * One hue in, a legal pair out: neon trails watt by HUE_SEPARATION and both
 * keep Outrun's lightness and chroma, so the glow rules and TV-mode
 * legibility survive whatever hue a rider lands on.
 */
export function customPalette(hue: number): Palette {
	const watt = normalizeHue(hue);
	const neon = normalizeHue(hue - HUE_SEPARATION);
	return {
		id: CUSTOM_ID,
		name: 'Custom',
		note: `watt ${Math.round(watt)}° · neon ${Math.round(neon)}°`,
		watt: {
			light: oklch(CUSTOM_LCH.wattLight, watt),
			dark: oklch(CUSTOM_LCH.wattDark, watt),
		},
		neon: {
			light: oklch(CUSTOM_LCH.neonLight, neon),
			dark: oklch(CUSTOM_LCH.neonDark, neon),
		},
	};
}

/** The css value for one token: both sides, resolved by the active scheme. */
export function tokenValue(pair: AccentPair): string {
	return `light-dark(${pair.light}, ${pair.dark})`;
}

export type PaletteChoice =
	| { kind: 'preset'; id: string }
	| { kind: 'custom'; hue: number };

export const DEFAULT_CHOICE: PaletteChoice = { kind: 'preset', id: DEFAULT_ID };

/**
 * Stored choices are untrusted input like any other: a hand-edited or stale
 * localStorage entry falls back to the shipped palette instead of painting
 * the app with whatever it found.
 */
export function parseChoice(raw: string | null): PaletteChoice {
	if (!raw) return DEFAULT_CHOICE;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CHOICE;
		const value = parsed as { kind?: unknown; id?: unknown; hue?: unknown };
		if (
			value.kind === 'custom' &&
			typeof value.hue === 'number' &&
			Number.isFinite(value.hue)
		) {
			return { kind: 'custom', hue: normalizeHue(value.hue) };
		}
		if (
			value.kind === 'preset' &&
			typeof value.id === 'string' &&
			PRESETS.some((p) => p.id === value.id)
		) {
			return { kind: 'preset', id: value.id };
		}
	} catch {
		/* malformed json: the shipped palette */
	}
	return DEFAULT_CHOICE;
}

/** The palette a choice names; an unknown preset id resolves to Outrun. */
export function resolve(choice: PaletteChoice): Palette {
	if (choice.kind === 'custom') return customPalette(choice.hue);
	return PRESETS.find((p) => p.id === choice.id) ?? PRESETS[0];
}
