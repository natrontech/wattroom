import { describe, expect, it } from 'vitest';
import {
	contrast,
	hexToOklch,
	hueDistance,
	inGamut,
	oklchToHex,
} from './color';
import {
	CONTRAST,
	DARK_SURFACE_MAX_L,
	TOKENS,
	WHITE_SURFACE_MIN_L,
	type Theme,
	type TokenName,
} from './palette';
import {
	CUSTOM_ID,
	DEFAULT_CHOICE,
	DEFAULT_DARK_ID,
	HUE_SEPARATION,
	THEMES,
	customTheme,
	parseChoice,
	resolveTheme,
	themeById,
	themesFor,
} from './themes';

const ZONES: TokenName[] = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'];
const each = THEMES.map((t) => [t.name, t] as const);

/** Viénot/Brettel/Mollon deuteranopia projection for an accessibility gate. */
function deuteranopia(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	const [r, g, b] = [
		((n >> 16) & 255) / 255,
		((n >> 8) & 255) / 255,
		(n & 255) / 255,
	];
	return [0.625 * r + 0.375 * g, 0.7 * r + 0.3 * g, 0.3 * g + 0.7 * b];
}

function rgbDistance(a: string, b: string): number {
	const left = deuteranopia(a);
	const right = deuteranopia(b);
	return Math.hypot(...left.map((value, i) => value - right[i]));
}

/** Worst contrast this token scores against the theme's own two surfaces. */
function worst(theme: Theme, token: TokenName): number {
	return Math.min(
		contrast(theme.tokens[token], theme.tokens.surface),
		contrast(theme.tokens[token], theme.tokens['surface-raised']),
	);
}

/** The issue gate, applied to catalogue entries and the full custom hue wheel. */
function expectLegible(theme: Theme, label: string) {
	for (const token of ['ink', 'muted'] as TokenName[]) {
		expect(worst(theme, token), `${label} ${token}`).toBeGreaterThanOrEqual(
			CONTRAST.text,
		);
	}
	for (const token of ['watt', 'neon', ...ZONES] as TokenName[]) {
		expect(worst(theme, token), `${label} ${token}`).toBeGreaterThanOrEqual(
			CONTRAST.accent,
		);
	}
	expect(
		contrast(theme.tokens.paper, theme.tokens.ink),
		`${label} paper on ink`,
	).toBeGreaterThanOrEqual(CONTRAST.text);
}

describe('colour maths', () => {
	it('round-trips the shipped accents', () => {
		for (const hex of ['#ff3d8b', '#8b2bff', '#e6247d', '#6f1ad1']) {
			expect(oklchToHex(hexToOklch(hex))).toBe(hex);
		}
	});

	it('reduces chroma rather than clipping out of gamut', () => {
		// Yellow cannot hold this much chroma; the result must still be yellow.
		const hex = oklchToHex({ l: 0.85, c: 0.4, h: 100 });
		expect(inGamut(hexToOklch(hex))).toBe(true);
		expect(hueDistance(hexToOklch(hex).h, 100)).toBeLessThan(12);
	});

	it('matches known WCAG ratios', () => {
		expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 1);
		expect(contrast('#0a0118', '#0a0118')).toBeCloseTo(1, 5);
	});
});

describe('the catalogue', () => {
	it('offers both families', () => {
		expect(themesFor('dark').length).toBeGreaterThan(1);
		expect(themesFor('white').length).toBeGreaterThan(1);
	});

	it('keeps Outrun accents and surfaces at the values app.css ships', () => {
		const k = themeById(DEFAULT_DARK_ID)!.tokens;
		expect(k.surface).toBe('#0a0118');
		expect(k['surface-raised']).toBe('#1a0736');
		expect(k.watt).toBe('#ff3d8b');
		expect(k.neon).toBe('#8b2bff');
	});

	it('gives every identity one theme in each family', () => {
		// The ride surface is always dark (ADR-0005) — a white theme still
		// resolves the dark half of the same identity inside .cave.
		for (const t of themesFor('white')) {
			expect(
				THEMES.some(
					(other) => other.identity === t.identity && other.family === 'dark',
				),
			).toBe(true);
		}
	});

	it('has unique ids and a complete token set', () => {
		expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
		for (const t of THEMES) {
			for (const token of TOKENS)
				expect(t.tokens[token]).toMatch(/^#[0-9a-f]{6}$/);
		}
	});
});

/** The gate: a theme that fails these is not shippable, whoever likes it. */
describe.each(each)('%s meets the contrast floors', (_name, theme: Theme) => {
	it('clears every text and graphics contrast gate', () => {
		expectLegible(theme, theme.name);
	});

	it('is as dark or as light as its family claims', () => {
		const l = hexToOklch(theme.tokens.surface).l;
		if (theme.family === 'dark')
			expect(l).toBeLessThanOrEqual(DARK_SURFACE_MAX_L);
		else expect(l).toBeGreaterThanOrEqual(WHITE_SURFACE_MIN_L);
	});

	it('keeps its two accents separable', () => {
		// ADR-0005: a glowing number must never read as chrome.
		expect(
			hueDistance(
				hexToOklch(theme.tokens.watt).h,
				hexToOklch(theme.tokens.neon).h,
			),
		).toBeGreaterThanOrEqual(30);
	});

	it('keeps adjacent zones tellable apart and monotonic in lightness', () => {
		for (let i = 0; i < ZONES.length - 1; i++) {
			const a = hexToOklch(theme.tokens[ZONES[i]]);
			const b = hexToOklch(theme.tokens[ZONES[i + 1]]);
			const apart = hueDistance(a.h, b.h) >= 10 || Math.abs(a.l - b.l) >= 0.06;
			expect(apart, `${ZONES[i]} vs ${ZONES[i + 1]}`).toBe(true);
			if (theme.family === 'dark') expect(b.l - a.l).toBeGreaterThan(0.015);
			else expect(a.l - b.l).toBeGreaterThan(0.015);
		}
	});

	it('keeps adjacent zones distinct under deuteranopia simulation', () => {
		for (let i = 0; i < ZONES.length - 1; i++) {
			expect(
				rgbDistance(theme.tokens[ZONES[i]], theme.tokens[ZONES[i + 1]]),
				`${ZONES[i]} vs ${ZONES[i + 1]}`,
			).toBeGreaterThanOrEqual(0.02);
		}
	});

	it('ends its ramp on the live-data hue', () => {
		// Z7 is maximum effort, so the ramp arrives at the colour that means
		// "live" — the property the shipped Outrun ramp already had.
		expect(
			hueDistance(
				hexToOklch(theme.tokens.z7).h,
				hexToOklch(theme.tokens.watt).h,
			),
		).toBeLessThan(15);
	});
});

describe('custom themes', () => {
	const hues = Array.from({ length: 24 }, (_, i) => i * 15);

	it.each(hues)('hue %i stays legible in both families', (hue) => {
		for (const family of ['dark', 'white'] as const) {
			const theme = customTheme(hue, family);
			expectLegible(theme, `custom ${family} ${hue}°`);
			expect(
				hueDistance(
					hexToOklch(theme.tokens.watt).h,
					hexToOklch(theme.tokens.neon).h,
				),
			).toBeGreaterThanOrEqual(30);
			for (let i = 0; i < ZONES.length - 1; i++) {
				const current = hexToOklch(theme.tokens[ZONES[i]]);
				const next = hexToOklch(theme.tokens[ZONES[i + 1]]);
				if (family === 'dark')
					expect(next.l - current.l).toBeGreaterThan(0.015);
				else expect(current.l - next.l).toBeGreaterThan(0.015);
				expect(
					rgbDistance(theme.tokens[ZONES[i]], theme.tokens[ZONES[i + 1]]),
				).toBeGreaterThanOrEqual(0.02);
			}
		}
	});

	it('trails chrome behind the data hue', () => {
		const k = customTheme(320, 'dark').tokens;
		expect(hueDistance(hexToOklch(k.watt).h, hexToOklch(k.neon).h)).toBeCloseTo(
			HUE_SEPARATION,
			0,
		);
	});

	it('derives a dark cave from the same custom hue', () => {
		const light = customTheme(200, 'white');
		const cave = customTheme(200, 'dark');
		expect(light.identity).toBe(cave.identity);
		expect(hexToOklch(cave.tokens.surface).l).toBeLessThanOrEqual(
			DARK_SURFACE_MAX_L,
		);
	});
});

describe('choice parsing', () => {
	it.each([
		['null', null],
		['empty', ''],
		['not json', '{oh no'],
		['not an object', '7'],
		['unknown preset', '{"kind":"preset","identity":"chartreuse"}'],
		['custom without hue', '{"kind":"custom"}'],
	])('falls back to the default for %s', (_case, raw) => {
		expect(parseChoice(raw)).toEqual(DEFAULT_CHOICE);
	});

	it('accepts a known identity and a normalised custom hue', () => {
		expect(parseChoice('{"kind":"preset","identity":"tron"}')).toEqual({
			kind: 'preset',
			identity: 'tron',
		});
		expect(parseChoice('{"kind":"custom","hue":-40}')).toEqual({
			kind: 'custom',
			hue: 320,
		});
	});

	it('migrates the accent-only preset schema', () => {
		expect(parseChoice('{"kind":"preset","id":"miami-nights"}')).toEqual({
			kind: 'preset',
			identity: 'miami',
		});
	});

	it('resolves unknown identities back to Outrun in the requested family', () => {
		expect(resolveTheme({ kind: 'preset', identity: 'gone' }, 'dark').id).toBe(
			DEFAULT_DARK_ID,
		);
		expect(resolveTheme({ kind: 'custom', hue: 90 }, 'white').id).toBe(
			CUSTOM_ID,
		);
	});
});
