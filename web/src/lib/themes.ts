/**
 * The theme catalogue (#331). Each identity exists twice — a dark theme and a
 * white one built from the same three hues — because the scheme setting picks
 * the family and a rider on either setting should still get their identity.
 *
 * Outrun pins the surfaces, text, and accents that shipped. Its old zone ramp
 * is regenerated because it did not clear #331's contrast/ordering gates.
 */
import { normalizeHue } from './color';
import {
	deriveTheme,
	type Theme,
	type ThemeFamily,
	type ThemeSpec,
} from './palette';

export const DEFAULT_DARK_ID = 'outrun';
export const DEFAULT_WHITE_ID = 'outrun-day';
export const DEFAULT_IDENTITY = 'outrun';
export const CUSTOM_ID = 'custom';

/** Degrees the chrome hue sits behind the live-data hue, as Outrun ships. */
export const HUE_SEPARATION = 65;

const SPECS: ThemeSpec[] = [
	{
		id: DEFAULT_DARK_ID,
		identity: 'outrun',
		name: 'Outrun',
		note: 'The shipped identity — magenta data in a violet-black cave.',
		family: 'dark',
		wattHue: 2,
		neonHue: 296,
		surfaceHue: 301,
		exact: {
			surface: '#0a0118',
			'surface-raised': '#1a0736',
			muted: '#9182b8',
			watt: '#ff3d8b',
			neon: '#8b2bff',
			ink: '#ffffff',
			paper: '#000000',
			// Pinned, not derived. Outrun is the reference every other theme is
			// measured against, and between #331 and #396 a derivation change
			// moved it without a decision (ADR-0020, consequences).
			z1: '#4a3a78',
			z2: '#4361ee',
			z3: '#00b4d8',
			z4: '#06d6a0',
			z5: '#ffa62b',
			z6: '#ff4d6d',
			z7: '#ff2e88',
		},
	},
	{
		id: 'tron-ice',
		identity: 'tron',
		name: 'Tron Ice',
		note: 'A blue-black room, cyan on the numbers. Colder for long sessions.',
		family: 'dark',
		wattHue: 200,
		neonHue: 265,
		surfaceHue: 265,
		wattLc: { l: 0.72, c: 0.13 },
	},
	{
		id: 'miami-nights',
		identity: 'miami',
		name: 'Miami Nights',
		note: 'Teal-black, coral data. The furthest thing here from Outrun.',
		family: 'dark',
		wattHue: 18,
		neonHue: 195,
		surfaceHue: 200,
	},
	{
		id: 'laser-yellow',
		identity: 'laser',
		name: 'Laser Yellow',
		note: 'The original watt-yellow, still over violet chrome.',
		family: 'dark',
		wattHue: 100,
		neonHue: 296,
		surfaceHue: 301,
		wattLc: { l: 0.85, c: 0.19 },
	},
	{
		id: DEFAULT_WHITE_ID,
		identity: 'outrun',
		name: 'Outrun Day',
		note: 'The daylight desk. Saturation marks live data; nothing glows.',
		family: 'white',
		wattHue: 0.3,
		neonHue: 296,
		surfaceHue: 305,
		exact: {
			surface: '#f6f2fa',
			'surface-raised': '#ffffff',
			muted: '#60548a',
			watt: '#e6247d',
			neon: '#6f1ad1',
			ink: '#180a2e',
			paper: '#ffffff',
			z1: '#5b4894',
			z2: '#3a56d4',
			z3: '#0090ad',
			z4: '#04a37c',
			z5: '#d97e00',
			z6: '#e63c5b',
			z7: '#d9186f',
		},
	},
	{
		id: 'tron-day',
		identity: 'tron',
		name: 'Tron Day',
		note: 'Cool paper, deep cyan data.',
		family: 'white',
		wattHue: 200,
		neonHue: 265,
		surfaceHue: 265,
		wattLc: { l: 0.55, c: 0.12 },
	},
	{
		id: 'miami-day',
		identity: 'miami',
		name: 'Miami Day',
		note: 'Warm paper, coral data over teal chrome.',
		family: 'white',
		wattHue: 18,
		neonHue: 195,
		surfaceHue: 200,
	},
	{
		id: 'laser-day',
		identity: 'laser',
		name: 'Laser Day',
		note: 'Amber data on paper — yellow has to darken to survive white.',
		family: 'white',
		wattHue: 88,
		neonHue: 296,
		surfaceHue: 301,
		wattLc: { l: 0.6, c: 0.13 },
	},
];

export const THEMES: Theme[] = SPECS.map(deriveTheme);

export function themesFor(family: ThemeFamily): Theme[] {
	return THEMES.filter((t) => t.family === family);
}

export function themeById(id: string): Theme | undefined {
	return THEMES.find((t) => t.id === id);
}

/** The half of an identity that belongs to this family. */
export function themeFor(identity: string, family: ThemeFamily): Theme {
	return (
		THEMES.find((t) => t.identity === identity && t.family === family) ??
		THEMES.find((t) => t.identity === 'outrun' && t.family === family)!
	);
}

/**
 * A custom theme from one hue: chrome trails HUE_SEPARATION behind it and the
 * surfaces take the chrome hue, so the room, its grid and its numbers all come
 * from a single choice.
 */
export function customTheme(hue: number, family: ThemeFamily): Theme {
	const wattHue = normalizeHue(hue);
	const chrome = normalizeHue(hue - HUE_SEPARATION);
	return deriveTheme({
		id: CUSTOM_ID,
		identity: CUSTOM_ID,
		name: 'Custom',
		note: `data ${Math.round(wattHue)}° · chrome ${Math.round(chrome)}°`,
		family,
		wattHue,
		neonHue: chrome,
		surfaceHue: chrome,
	});
}

/**
 * What the rider chose — an identity or a hue, never a family. The family
 * comes from the scheme setting at apply time, so the existing auto/dark/light
 * toggle keeps working and following the OS still means something.
 */
export type ThemeChoice =
	{ kind: 'preset'; identity: string } | { kind: 'custom'; hue: number };

export const DEFAULT_CHOICE: ThemeChoice = {
	kind: 'preset',
	identity: DEFAULT_IDENTITY,
};

/** The theme a choice names, in the family currently in force. */
export function resolveTheme(choice: ThemeChoice, family: ThemeFamily): Theme {
	if (choice.kind === 'custom') return customTheme(choice.hue, family);
	return themeFor(choice.identity, family);
}

/**
 * Stored choices are untrusted like any other input: a hand-edited or stale
 * entry falls back to the default rather than painting the app with whatever
 * it found.
 */
export function parseChoice(raw: string | null): ThemeChoice {
	if (!raw) return DEFAULT_CHOICE;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CHOICE;
		const v = parsed as {
			kind?: unknown;
			id?: unknown;
			identity?: unknown;
			hue?: unknown;
		};
		if (
			v.kind === 'custom' &&
			typeof v.hue === 'number' &&
			Number.isFinite(v.hue)
		) {
			return { kind: 'custom', hue: normalizeHue(v.hue) };
		}
		if (v.kind === 'preset' && typeof v.identity === 'string') {
			const known = THEMES.some((t) => t.identity === v.identity);
			if (known) return { kind: 'preset', identity: v.identity };
		}
		// Migrate the accent-only picker schema from #292. Its ids named one
		// family half; the full-theme choice stores the shared identity instead.
		if (v.kind === 'preset' && typeof v.id === 'string') {
			const migrated = themeById(v.id);
			if (migrated) return { kind: 'preset', identity: migrated.identity };
		}
	} catch {
		/* malformed json: the default */
	}
	return DEFAULT_CHOICE;
}
