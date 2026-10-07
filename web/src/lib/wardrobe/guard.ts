import {
	hexToOklch,
	hueDistance,
	oklchToHex,
	perceptualDistance,
} from '$lib/color';
import { catalogue } from './catalogue';

/**
 * The kit colour guard at render time (#3156): the catalogue's guard, run
 * again for the theme of whoever is looking. Themes carry different watt
 * hues, so a kit colour that is fine for one viewer can read as live data
 * for another; it is desaturated for that viewer only, and nothing anyone
 * else sees changes.
 */

/** What a viewer's theme paints live data with: its watt, and the seven zones. */
export type Viewer = { watt: string; zones: readonly string[] };

const { wattHueBandDeg, wattChromaMax, zoneMinDeltaE, kitLightness } =
	catalogue.guard;
/** OKLCH chroma each step of the desaturation takes. */
const STEP = 0.005;

/** Whether a colour reads as live data to `viewer`: near their watt, or near a zone. */
export function collides(hex: string, viewer: Viewer): boolean {
	const c = hexToOklch(hex);
	const watt = hexToOklch(viewer.watt);
	return (
		(c.c > wattChromaMax && hueDistance(c.h, watt.h) < wattHueBandDeg) ||
		viewer.zones.some((z) => perceptualDistance(hex, z) < zoneMinDeltaE)
	);
}

/** A kit colour as `viewer` may be shown it: inside the kit's lightness, and desaturated until it collides with nothing. */
export function guarded(hex: string, viewer: Viewer): string {
	const [lo, hi] = kitLightness;
	let c = hexToOklch(hex);
	c = { ...c, l: Math.min(hi, Math.max(lo, c.l)) };
	let out = oklchToHex(c);
	while (c.c > 0 && collides(out, viewer)) {
		c = { ...c, c: Math.max(0, c.c - STEP) };
		out = oklchToHex(c);
	}
	return out;
}
