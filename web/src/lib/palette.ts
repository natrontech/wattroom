/**
 * Themes (#331). A theme owns every colour token, not just the accents, and is
 * derived rather than hand-picked: lightness and chroma are pinned per family
 * and hue is the only free variable. That is what makes an unfamiliar theme
 * safe — it inherits the legibility of the one that shipped instead of
 * re-rolling it.
 *
 * ADR-0005's restraint rule is unchanged and is expressed here: `watt` marks
 * live data and is the only token that glows, `neon` is chrome. The zone ramp
 * sweeps from neon to watt, so intensity climbs from the room's own hue to the
 * live-data hue — which is exactly what the shipped Outrun ramp already did.
 *
 * Pure: the DOM lives in palette.svelte.ts, so every rule here is testable.
 */
import { fitContrast, oklchToHex, type Oklch } from './color';

export const TOKENS = [
	'surface',
	'surface-raised',
	'muted',
	'watt',
	'neon',
	'ink',
	'paper',
	'danger',
	'z1',
	'z2',
	'z3',
	'z4',
	'z5',
	'z6',
	'z7',
] as const;

export type TokenName = (typeof TOKENS)[number];
export type Tokens = Record<TokenName, string>;

/** Dark themes are offered under the dark scheme, white ones under light. */
export type ThemeFamily = 'dark' | 'white';

export interface Theme {
	id: string;
	/**
	 * What the rider actually chose. Each identity exists in both families, so
	 * the scheme setting can flip between them without losing the choice — and
	 * `.cave`, which is always dark (ADR-0005, amended in #113), can render the
	 * dark half of the same identity rather than something unrelated.
	 */
	identity: string;
	name: string;
	note: string;
	family: ThemeFamily;
	tokens: Tokens;
}

export interface ThemeSpec {
	id: string;
	identity: string;
	name: string;
	note: string;
	family: ThemeFamily;
	/** Live data. */
	wattHue: number;
	/** Chrome. Also the cold end of the zone ramp. */
	neonHue: number;
	/** Surfaces, muted text and ink. */
	surfaceHue: number;
	/**
	 * Lightness/chroma escape hatch for the watt token. Yellow and green cannot
	 * reach the family's default chroma at its default lightness, so a theme
	 * built on them says so explicitly rather than silently gamut-clipping to
	 * mud. Still gate-checked like everything else.
	 */
	wattLc?: { l: number; c: number };
	/** Exact values that win over derivation — Outrun pins the shipped hexes. */
	exact?: Partial<Tokens>;
}

/**
 * Lightness and chroma per family. Surfaces, text, and accents are anchored to
 * the shipped tokens; zone lightness is the monotonic, contrast-gated ramp
 * adopted in #331. Changing a number here restyles every theme at once, which
 * is the point: the relationships live in one place.
 */
const FAMILY: Record<
	ThemeFamily,
	{
		surface: Oklch;
		raised: Oklch;
		muted: Oklch;
		ink: Oklch;
		paper: Oklch;
		watt: Oklch;
		neon: Oklch;
		danger: Oklch;
		zones: Oklch[];
	}
> = {
	dark: {
		surface: { l: 0.122, c: 0.057, h: 0 },
		raised: { l: 0.196, c: 0.085, h: 0 },
		muted: { l: 0.64, c: 0.081, h: 0 },
		ink: { l: 1, c: 0, h: 0 },
		paper: { l: 0, c: 0, h: 0 },
		watt: { l: 0.673, c: 0.233, h: 0 },
		neon: { l: 0.56, c: 0.277, h: 0 },
		danger: { l: 0.68, c: 0.2, h: 0 },
		// The ramp ADR-0005 shipped, measured. Lightness peaks at Z5 and
		// descends into the hot zones while chroma climbs — that shape is what
		// keeps Z6/Z7 vivid, and replacing it with an even climb is what made
		// them pale (#396, ADR-0023 §4).
		zones: [
			{ l: 0.397, c: 0.102, h: 293 },
			{ l: 0.556, c: 0.214, h: 269 },
			{ l: 0.711, c: 0.129, h: 219 },
			{ l: 0.777, c: 0.16, h: 167 },
			{ l: 0.796, c: 0.162, h: 68 },
			{ l: 0.679, c: 0.213, h: 15 },
			{ l: 0.662, c: 0.244, h: 2 },
		],
	},
	white: {
		surface: { l: 0.967, c: 0.011, h: 0 },
		raised: { l: 1, c: 0, h: 0 },
		muted: { l: 0.481, c: 0.086, h: 0 },
		ink: { l: 0.19, c: 0.069, h: 0 },
		paper: { l: 1, c: 0, h: 0 },
		watt: { l: 0.611, c: 0.23, h: 0 },
		neon: { l: 0.475, c: 0.243, h: 0 },
		danger: { l: 0.52, c: 0.2, h: 0 },
		zones: [
			{ l: 0.459, c: 0.12, h: 292 },
			{ l: 0.51, c: 0.196, h: 269 },
			{ l: 0.604, c: 0.109, h: 219 },
			{ l: 0.636, c: 0.128, h: 168 },
			{ l: 0.678, c: 0.155, h: 63 },
			{ l: 0.618, c: 0.205, h: 16 },
			{ l: 0.578, c: 0.223, h: 2 },
		],
	},
};

/** Absolute WCAG contrast floors for text and meaning-carrying graphics. */
export const CONTRAST = { text: 4.5, accent: 3 } as const;

/** A dark theme's surface must actually be dark; a white one's actually light. */
export const DARK_SURFACE_MAX_L = 0.3;
export const WHITE_SURFACE_MIN_L = 0.9;

/**
 * The contrast a zone fill is fitted to, measured off the reference ramp
 * rather than taken from WCAG's 3:1 for graphical objects. Outrun's own Z1
 * sits at 1.9 because recovery is meant to recede, and holding derived themes
 * to a floor the reference does not meet brightens their Z1 into Z2 — the
 * ramp stops being the ramp (ADR-0023 §3). Zone bars carry length as well as
 * colour, and #401 tracks giving them a non-colour channel outright.
 */
const ZONE_MIN_CONTRAST: Record<ThemeFamily, number> = {
	dark: 1.8,
	white: 2.6,
};

/**
 * The share of its designed chroma a zone must keep (ADR-0023 §2). Apparent
 * intensity comes from chroma as much as lightness, so the fitter may not buy
 * contrast by draining the colour — that is exactly how Z7 lost 72% of its
 * chroma and became the palest thing on screen.
 */
const ZONE_CHROMA_FLOOR = 0.8;

/**
 * Danger is semantic, not data (#397): a destructive control must be the same
 * colour whatever identity the rider picked, so its hue is pinned here and
 * only lightness and chroma follow the family. Red-orange in OKLCH.
 */
export const DANGER_HUE = 25;

export function deriveTheme(spec: ThemeSpec): Theme {
	const f = FAMILY[spec.family];
	const at = (base: Oklch, h: number) => oklchToHex({ ...base, h });
	const tokens: Tokens = {
		surface: at(f.surface, spec.surfaceHue),
		'surface-raised': at(f.raised, spec.surfaceHue),
		muted: at(f.muted, spec.surfaceHue),
		watt: at(spec.wattLc ? { ...spec.wattLc, h: 0 } : f.watt, spec.wattHue),
		neon: at(f.neon, spec.neonHue),
		ink: at(f.ink, spec.surfaceHue),
		paper: at(f.paper, spec.surfaceHue),
		danger: '',
		z1: '',
		z2: '',
		z3: '',
		z4: '',
		z5: '',
		z6: '',
		z7: '',
	};
	const backgrounds = [tokens.surface, tokens['surface-raised']];
	const away = spec.family === 'dark' ? 'lighter' : 'darker';
	tokens.danger = oklchToHex(
		fitContrast(
			{ ...f.danger, h: DANGER_HUE },
			backgrounds,
			CONTRAST.accent,
			away,
		),
	);
	// The ramp is shared, not themed (ADR-0023 §4). It is still fitted against
	// *this* theme's surfaces, because a blue-black room and a violet-black one
	// are not the same background.
	f.zones.forEach((zone, i) => {
		const fitted = fitContrast(
			zone,
			backgrounds,
			ZONE_MIN_CONTRAST[spec.family],
			away,
			zone.c * ZONE_CHROMA_FLOOR,
		);
		tokens[`z${i + 1}` as TokenName] = oklchToHex(fitted);
	});
	return {
		id: spec.id,
		identity: spec.identity,
		name: spec.name,
		note: spec.note,
		family: spec.family,
		tokens: { ...tokens, ...spec.exact },
	};
}
