import { describe, expect, it } from 'vitest';
import { hexToOklch } from '$lib/color';
import { themesFor } from '$lib/themes';
import { catalogue } from './catalogue';
import { collides, guarded, type Viewer } from './guard';

const viewerOf = (identity: string): Viewer => {
	const t = themesFor('dark').find((x) => x.identity === identity)!.tokens;
	return {
		watt: t.watt,
		zones: [t.z1, t.z2, t.z3, t.z4, t.z5, t.z6, t.z7],
	};
};
const outrun = viewerOf('outrun');
const laser = viewerOf('laser');
const hexOf = (id: string) => catalogue.palette.find((p) => p.id === id)!.hex;

describe('the kit colour guard, per viewer (#3156)', () => {
	it('desaturates a colour near the viewer’s watt for that viewer only', () => {
		// Lime sits in Laser's yellow watt band, and far from Outrun's magenta.
		const lime = hexOf('lime');
		expect(collides(lime, laser)).toBe(true);
		expect(collides(lime, outrun)).toBe(false);
		expect(guarded(lime, outrun)).toBe(lime);
		const forLaser = guarded(lime, laser);
		expect(collides(forLaser, laser)).toBe(false);
		expect(hexToOklch(forLaser).c).toBeLessThan(hexToOklch(lime).c);
	});

	it('moves a colour off a zone token', () => {
		expect(collides(outrun.zones[3], outrun)).toBe(true);
		expect(collides(guarded(outrun.zones[3], outrun), outrun)).toBe(false);
	});

	it('leaves no catalogue colour reading as live data, and keeps it inside the kit’s lightness, for every dark theme', () => {
		const [lo, hi] = catalogue.guard.kitLightness;
		for (const theme of themesFor('dark')) {
			const viewer = viewerOf(theme.identity);
			for (const { id, hex } of catalogue.palette) {
				const shown = guarded(hex, viewer);
				expect(collides(shown, viewer), `${theme.identity}: ${id}`).toBe(false);
				const l = hexToOklch(shown).l;
				expect(l).toBeGreaterThanOrEqual(lo - 0.005);
				expect(l).toBeLessThanOrEqual(hi + 0.005);
			}
		}
	});
});
