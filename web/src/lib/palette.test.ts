import { describe, expect, it } from 'vitest';
import {
	contrast,
	dichromatDistance,
	hexToOklch,
	hueDistance,
	inGamut,
	oklchToHex,
	perceptualDistance,
} from './color';
import {
	CONTRAST,
	DANGER_HUE,
	DARK_SURFACE_MAX_L,
	TOKENS,
	WHITE_SURFACE_MIN_L,
	type Theme,
	type TokenName,
} from './palette';
import {
	EXCEPTIONS,
	ZONES,
	adjacentFloor,
	exemption,
	gateChecks,
	reference,
	worst,
	zoneFloor,
} from './gate';
import {
	DEFAULT_CHOICE,
	DEFAULT_DARK_ID,
	THEMES,
	parseChoice,
	resolveTheme,
	serializeChoice,
	themeById,
	themesFor,
} from './themes';

const each = THEMES.map((t) => [t.name, t] as const);

/** The issue gate, applied to every catalogue entry. */
function expectLegible(theme: Theme, label: string) {
	const ref = reference(theme.family, THEMES);
	for (const token of ['ink', 'muted'] as TokenName[]) {
		expect(worst(theme, token), `${label} ${token}`).toBeGreaterThanOrEqual(
			CONTRAST.text,
		);
	}
	for (const token of ['watt', 'neon', 'danger'] as TokenName[]) {
		expect(worst(theme, token), `${label} ${token}`).toBeGreaterThanOrEqual(
			CONTRAST.accent,
		);
	}
	for (const token of ZONES) {
		if (exemption(theme.id, token)) continue;
		expect(worst(theme, token), `${label} ${token}`).toBeGreaterThanOrEqual(
			zoneFloor(token, ref),
		);
	}
	// Apparent intensity is chroma as much as lightness (ADR-0023 §2): a zone
	// that keeps its contrast by going pale has not passed, it has faded.
	for (const token of ZONES) {
		expect(
			hexToOklch(theme.tokens[token]).c,
			`${label} ${token} chroma`,
		).toBeGreaterThanOrEqual(hexToOklch(ref.tokens[token]).c * 0.8);
	}
	expect(
		contrast(theme.tokens.paper, theme.tokens.ink),
		`${label} paper on ink`,
	).toBeGreaterThanOrEqual(CONTRAST.text);
	// btn-danger-solid (app.css) sets paper on a danger fill.
	expect(
		contrast(theme.tokens.paper, theme.tokens.danger),
		`${label} paper on danger`,
	).toBeGreaterThanOrEqual(CONTRAST.text);
}

/** A theme cannot rotate danger: the hue is the meaning (#397). */
function expectDangerFixed(theme: Theme, label: string) {
	expect(
		hueDistance(hexToOklch(theme.tokens.danger).h, DANGER_HUE),
		`${label} danger hue`,
	).toBeLessThanOrEqual(15);
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

/**
 * A named exception is a decision, not permanent code nobody looks at again:
 * if the check it waives has quietly started passing (a derivation change, a
 * hand-edited hex), the entry is stale and EXCEPTIONS should shrink, not just
 * grow.
 */
describe.each(EXCEPTIONS)(
	'the $themeId exception for $checkId',
	({ themeId, checkId }) => {
		it('is still actually needed', () => {
			const theme = themeById(themeId);
			expect(theme, `${themeId} is a real catalogue theme`).toBeDefined();
			const found = gateChecks(theme!, THEMES).find((c) => c.id === checkId);
			expect(
				found,
				`${themeId} has a gate check named ${checkId}`,
			).toBeDefined();
			expect(
				found!.passes,
				`${themeId} ${checkId} now passes — remove this exception`,
			).toBe(false);
		});
	},
);

/** The gate: a theme that fails these is not shippable, whoever likes it. */
describe.each(each)('%s meets the contrast floors', (_name, theme: Theme) => {
	it('clears every text and graphics contrast gate', () => {
		expectLegible(theme, theme.name);
	});

	it('keeps danger on the danger hue', () => {
		expectDangerFixed(theme, theme.name);
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

	// Not monotonic in lightness on purpose: the ramp peaks at Z5 and descends
	// while chroma climbs, which is what keeps the hot end vivid (ADR-0023 §4).
	it('keeps adjacent zones perceptually apart', () => {
		const ref = reference(theme.family, THEMES);
		for (let i = 0; i < ZONES.length - 1; i++) {
			expect(
				perceptualDistance(theme.tokens[ZONES[i]], theme.tokens[ZONES[i + 1]]),
				`${ZONES[i]} vs ${ZONES[i + 1]}`,
			).toBeGreaterThanOrEqual(adjacentFloor(ref, i, perceptualDistance));
		}
	});

	it.each(['deuteranopia', 'protanopia'] as const)(
		'keeps adjacent zones apart under %s',
		(kind) => {
			// Zones encode how hard you are riding; colour is the only channel
			// the bar has, so the ramp has to survive the ~8% who see it
			// differently (#401).
			const ref = reference(theme.family, THEMES);
			for (let i = 0; i < ZONES.length - 1; i++) {
				if (exemption(theme.id, `${ZONES[i]}-${ZONES[i + 1]}-${kind}`))
					continue;
				const measure = (a: string, b: string) => dichromatDistance(a, b, kind);
				expect(
					measure(theme.tokens[ZONES[i]], theme.tokens[ZONES[i + 1]]),
					`${ZONES[i]} vs ${ZONES[i + 1]}`,
				).toBeGreaterThanOrEqual(adjacentFloor(ref, i, measure));
			}
		},
	);

	it('shares the reference ramp — zones are a scale, not branding', () => {
		// Zone colour is learned ("green is threshold") and is read across the
		// room. Rotating it per theme would make a rider relearn the scale for
		// a palette choice, and the sRGB gamut does not rotate evenly anyway
		// (ADR-0023 §4).
		const ref = reference(theme.family, THEMES).tokens;
		for (const token of ZONES) {
			expect(
				hueDistance(
					hexToOklch(theme.tokens[token]).h,
					hexToOklch(ref[token]).h,
				),
				`${theme.id} ${token} hue`,
			).toBeLessThan(8);
		}
	});
});

describe('choice parsing', () => {
	it.each([
		['null', null],
		['empty', ''],
		['not json', '{oh no'],
		['not an object', '7'],
		['unknown preset', '{"kind":"preset","identity":"chartreuse"}'],
	])('falls back to the default for %s', (_case, raw) => {
		expect(parseChoice(raw)).toEqual(DEFAULT_CHOICE);
	});

	it('accepts a known identity', () => {
		expect(parseChoice('{"kind":"preset","identity":"tron"}')).toEqual({
			kind: 'preset',
			identity: 'tron',
		});
	});

	it('serialises the default as "" and round-trips the rest (#326)', () => {
		expect(serializeChoice(DEFAULT_CHOICE)).toBe('');
		const tron = { kind: 'preset', identity: 'tron' } as const;
		expect(parseChoice(serializeChoice(tron))).toEqual(tron);
	});

	it('migrates the accent-only preset schema', () => {
		expect(parseChoice('{"kind":"preset","id":"miami-nights"}')).toEqual({
			kind: 'preset',
			identity: 'miami',
		});
	});

	// #692: the free hue picker is gone, but a rider's device or account can
	// still hold a pre-#692 `custom` choice. It must resolve to a real preset,
	// never a dead `custom` theme id, and land closest to the hue it replaces.
	it('migrates a stored custom hue to the nearest preset', () => {
		// Laser Yellow ships at wattHue 100 (dark) — a custom hue right on top
		// of it should migrate there, not to the default Outrun.
		expect(parseChoice('{"kind":"custom","hue":100}')).toEqual({
			kind: 'preset',
			identity: 'laser',
		});
	});

	it('falls back to the default for a custom choice with no usable hue', () => {
		expect(parseChoice('{"kind":"custom"}')).toEqual(DEFAULT_CHOICE);
	});

	it('resolves unknown identities back to Outrun in the requested family', () => {
		expect(resolveTheme({ kind: 'preset', identity: 'gone' }, 'dark').id).toBe(
			DEFAULT_DARK_ID,
		);
	});
});
