import { describe, expect, it } from 'vitest';
import { hexToOklch, hueDistance } from '$lib/color';
import { WATT_HUES } from './placement/safety';
import { appCss, RIDE } from './look.test-helper';

describe('the ride look is the world token family (ADR-0072, #3085)', () => {
	it('pins the peach band to OKLCH 58–60°, at least 40° from every dark identity’s watt', () => {
		const peach = hexToOklch(RIDE.sky.band!);
		expect(peach.h).toBeGreaterThanOrEqual(58);
		expect(peach.h).toBeLessThanOrEqual(60);
		for (const h of WATT_HUES)
			expect(hueDistance(peach.h, h)).toBeGreaterThanOrEqual(40);
	});

	it('paints the sky cool, blue the highest channel, darker toward the zenith', () => {
		const rgb = (hex: string) =>
			[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
		const zenith = rgb(RIDE.sky.top);
		const haze = rgb(RIDE.sky.horizon);
		for (const [r, g, b] of [zenith, haze])
			expect(b).toBeGreaterThan(Math.max(r, g));
		expect(zenith.reduce((s, v) => s + v)).toBeLessThan(
			haze.reduce((s, v) => s + v),
		);
	});

	it('takes its accents — the trail and the zones — from the rider’s theme', () => {
		expect(RIDE.trail).toBe(appCss('color-watt'));
		expect(RIDE.zones).toEqual(
			[1, 2, 3, 4, 5, 6, 7].map((z) => appCss(`color-z${z}`)),
		);
	});
});
