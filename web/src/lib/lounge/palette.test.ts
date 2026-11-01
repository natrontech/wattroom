import { describe, expect, it } from 'vitest';
import { hexToOklch, hueDistance } from '$lib/color';
import { themeFor } from '$lib/themes';
import { LOUNGE, applyLoungeTheme } from '$lib/lounge/palette';

describe('the lounge in the rider’s theme', () => {
	it('is a pale room in a light theme and a dark one in a dark theme', () => {
		applyLoungeTheme(themeFor('outrun', 'light'));
		expect(hexToOklch(LOUNGE.wall).l).toBeGreaterThan(0.85);
		expect(hexToOklch(LOUNGE.ink).l).toBeLessThan(0.35);
		applyLoungeTheme(themeFor('outrun', 'dark'));
		expect(hexToOklch(LOUNGE.wall).l).toBeLessThan(0.3);
	});

	it('turns its walls to the theme’s hue and takes its accents', () => {
		const theme = themeFor('tron', 'dark');
		applyLoungeTheme(theme);
		const neon = hexToOklch(theme.tokens.neon).h;
		expect(hueDistance(hexToOklch(LOUNGE.wall).h, neon)).toBeLessThan(25);
		expect(LOUNGE.frame).toBe(theme.tokens.neon);
		expect(LOUNGE.watt).toBe(theme.tokens.watt);
	});
});
