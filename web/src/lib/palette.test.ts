import { describe, expect, it } from 'vitest';
import {
	CUSTOM_ID,
	DEFAULT_CHOICE,
	DEFAULT_ID,
	HUE_SEPARATION,
	MIN_HUE_SEPARATION,
	PRESETS,
	customPalette,
	hueDistance,
	normalizeHue,
	parseChoice,
	resolve,
	tokenValue,
} from './palette';

/** Hue of an oklch() string, for asserting on generated custom palettes. */
function hueOf(color: string): number {
	const match = /oklch\([\d.]+ [\d.]+ ([\d.]+)\)/.exec(color);
	if (!match) throw new Error(`not an oklch colour: ${color}`);
	return Number(match[1]);
}

describe('normalizeHue', () => {
	it.each([
		[0, 0],
		[360, 0],
		[-65, 295],
		[420, 60],
		[-400, 320],
	])('wraps %i into %i', (input, expected) => {
		expect(normalizeHue(input)).toBe(expected);
	});
});

describe('hueDistance', () => {
	it.each([
		[0, 65, 65],
		[350, 30, 40],
		[0, 180, 180],
		[0, 190, 170],
	])('measures %i to %i as %i', (a, b, expected) => {
		expect(hueDistance(a, b)).toBe(expected);
	});
});

describe('presets', () => {
	it('starts with Outrun, the palette app.css already defines', () => {
		expect(PRESETS[0].id).toBe(DEFAULT_ID);
		expect(PRESETS[0].watt).toEqual({ light: '#e6247d', dark: '#ff3d8b' });
		expect(PRESETS[0].neon).toEqual({ light: '#6f1ad1', dark: '#8b2bff' });
	});

	it('has unique ids', () => {
		const ids = PRESETS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	// The rule ADR-0005 exists to protect: if a future preset lets the two
	// accents converge, a glowing number starts reading as chrome.
	it.each(PRESETS.map((p) => [p.name, p] as const))(
		'%s keeps its two accents distinguishable',
		(_name, preset) => {
			expect(preset.watt.light).not.toBe(preset.neon.light);
			expect(preset.watt.dark).not.toBe(preset.neon.dark);
		},
	);
});

describe('customPalette', () => {
	it('trails neon behind watt by the shipped separation', () => {
		const p = customPalette(320);
		expect(hueOf(p.watt.dark)).toBe(320);
		expect(hueOf(p.neon.dark)).toBe(normalizeHue(320 - HUE_SEPARATION));
		expect(hueDistance(hueOf(p.watt.dark), hueOf(p.neon.dark))).toBe(
			HUE_SEPARATION,
		);
	});

	it('stays legal at every hue, including the wrap', () => {
		for (let hue = 0; hue < 360; hue += 15) {
			const p = customPalette(hue);
			const gap = hueDistance(hueOf(p.watt.dark), hueOf(p.neon.dark));
			expect(gap).toBeGreaterThanOrEqual(MIN_HUE_SEPARATION);
		}
	});

	it('normalises out-of-range hues instead of emitting them', () => {
		expect(hueOf(customPalette(-40).watt.dark)).toBe(320);
		expect(hueOf(customPalette(400).watt.dark)).toBe(40);
	});

	it('keeps Outrun lightness and chroma so legibility is inherited', () => {
		const p = customPalette(200);
		expect(p.watt.dark).toBe('oklch(0.673 0.233 200.0)');
		expect(p.neon.dark).toBe('oklch(0.56 0.277 135.0)');
	});
});

describe('parseChoice', () => {
	it.each([
		['null storage', null],
		['empty string', ''],
		['not json', '{oh no'],
		['not an object', '42'],
		['unknown preset', '{"kind":"preset","id":"chartreuse"}'],
		['custom without a hue', '{"kind":"custom"}'],
		['custom with a non-finite hue', '{"kind":"custom","hue":null}'],
	])('falls back to the shipped palette for %s', (_case, raw) => {
		expect(parseChoice(raw)).toEqual(DEFAULT_CHOICE);
	});

	it('accepts a known preset', () => {
		expect(parseChoice('{"kind":"preset","id":"tron-ice"}')).toEqual({
			kind: 'preset',
			id: 'tron-ice',
		});
	});

	it('accepts and normalises a custom hue', () => {
		expect(parseChoice('{"kind":"custom","hue":-40}')).toEqual({
			kind: 'custom',
			hue: 320,
		});
	});
});

describe('resolve', () => {
	it('returns the named preset', () => {
		expect(resolve({ kind: 'preset', id: 'miami-nights' }).name).toBe(
			'Miami Nights',
		);
	});

	it('falls back to Outrun for an id that no longer exists', () => {
		expect(resolve({ kind: 'preset', id: 'gone' }).id).toBe(DEFAULT_ID);
	});

	it('builds a custom palette from a hue', () => {
		expect(resolve({ kind: 'custom', hue: 90 }).id).toBe(CUSTOM_ID);
	});
});

describe('tokenValue', () => {
	it('emits the light-dark() pair app.css expects', () => {
		expect(tokenValue({ light: '#aaa', dark: '#bbb' })).toBe(
			'light-dark(#aaa, #bbb)',
		);
	});
});
