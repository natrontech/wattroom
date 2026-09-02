/**
 * Colour maths for the theme system (#331). OKLCH in, sRGB hex out, plus the
 * WCAG contrast used to gate a theme before it can ship.
 *
 * Themes are derived rather than hand-picked, so this file is where "does it
 * look good" becomes arithmetic: lightness and chroma are pinned per family
 * and only hue moves, and every generated token is checked against the surface
 * it lands on. Pure — no DOM, so the gates run in tests.
 */

export interface Oklch {
	l: number;
	c: number;
	h: number;
}

/** Wrap any angle into [0, 360). */
export function normalizeHue(hue: number): number {
	return ((hue % 360) + 360) % 360;
}

/** Shortest angular distance between two hues, 0–180. */
export function hueDistance(a: number, b: number): number {
	const d = Math.abs(normalizeHue(a) - normalizeHue(b));
	return d > 180 ? 360 - d : d;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function gamma(c: number): number {
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function ungamma(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear-light sRGB for an OKLCH colour. Components may fall outside 0–1. */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
	const rad = (normalizeHue(h) * Math.PI) / 180;
	const a = c * Math.cos(rad);
	const b = c * Math.sin(rad);
	const ll = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const mm = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const ss = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss,
		-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss,
		-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss,
	];
}

/** True when the colour fits sRGB without clipping. */
export function inGamut(colour: Oklch): boolean {
	return oklchToLinear(colour)
		.map(gamma)
		.every((v) => v >= -0.001 && v <= 1.001);
}

/**
 * Nearest in-gamut hex. Chroma is reduced before anything else is touched:
 * dropping saturation keeps the hue and lightness a theme was designed
 * around, where naive clipping shifts both.
 */
export function oklchToHex(colour: Oklch): string {
	let { c } = colour;
	while (c > 0 && !inGamut({ ...colour, c })) c -= 0.002;
	const rgb = oklchToLinear({ ...colour, c: Math.max(0, c) }).map(gamma);
	return `#${rgb
		.map((v) =>
			Math.round(clamp01(v) * 255)
				.toString(16)
				.padStart(2, '0'),
		)
		.join('')}`;
}

export function hexToOklch(hex: string): Oklch {
	const n = parseInt(hex.slice(1), 16);
	const r = ungamma(((n >> 16) & 255) / 255);
	const g = ungamma(((n >> 8) & 255) / 255);
	const b = ungamma((n & 255) / 255);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	let h = (Math.atan2(B, A) * 180) / Math.PI;
	if (h < 0) h += 360;
	return {
		l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		c: Math.hypot(A, B),
		h,
	};
}

function relativeLuminance(hex: string): number {
	const n = parseInt(hex.slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
		ungamma(v / 255),
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colours, 1–21. */
export function contrast(a: string, b: string): number {
	const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
		(x, y) => y - x,
	);
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * Nudge lightness until a colour clears `target` contrast against every
 * background, moving away from them. OKLCH lightness is perceptual, not
 * photometric: at a fixed L, a yellow and a blue land at very different
 * luminances, so a ramp pinned to one lightness curve passes at some hues and
 * fails at others. Solving for the constraint makes the gate structural
 * instead of lucky.
 *
 * Returns the original when no amount of nudging helps, so the caller's own
 * assertion is what fails rather than this looping forever.
 */
export function fitContrast(
	colour: Oklch,
	backgrounds: string[],
	target: number,
	direction: 'lighter' | 'darker',
	minChroma = 0,
): Oklch {
	const step = direction === 'lighter' ? 0.01 : -0.01;
	let candidate = { ...colour };
	for (let i = 0; i < 60; i++) {
		const hex = oklchToHex(candidate);
		if (backgrounds.every((bg) => contrast(hex, bg) >= target))
			return candidate;
		const next = candidate.l + step;
		if (next <= 0.02 || next >= 0.99) break;
		// Chroma is a floor, not slack (ADR-0023). Past the point where the hue
		// can no longer hold its saturation in gamut, nudging lightness buys
		// contrast by draining the colour — which is how Z7 became pale pink.
		if (minChroma > 0 && maxChroma({ ...candidate, l: next }) < minChroma)
			break;
		candidate = { ...candidate, l: next };
	}
	return candidate;
}

/** The most chroma this lightness and hue can hold inside sRGB. */
export function maxChroma(colour: Oklch): number {
	let c = colour.c;
	while (c > 0 && !inGamut({ ...colour, c })) c -= 0.002;
	return Math.max(0, c);
}

/**
 * Perceptual distance in OKLab. Unlike contrast — which only ever compares a
 * colour to its background — this answers "can these two be told apart", which
 * is the question the zone ramp actually asks (ADR-0023).
 */
export function perceptualDistance(a: string, b: string): number {
	const [x, y] = [hexToOklch(a), hexToOklch(b)];
	const rad = (h: number) => (h * Math.PI) / 180;
	const ax = x.c * Math.cos(rad(x.h));
	const ay = x.c * Math.sin(rad(x.h));
	const bx = y.c * Math.cos(rad(y.h));
	const by = y.c * Math.sin(rad(y.h));
	return Math.hypot(x.l - y.l, ax - bx, ay - by);
}

export type ColourVision = 'deuteranopia' | 'protanopia';

/**
 * Viénot/Brettel/Mollon dichromat projection, applied in **linear light**.
 * Running the matrix on gamma-encoded sRGB — as the first version of this gate
 * did — skews the simulation and flatters the palette.
 */
export function simulate(
	hex: string,
	kind: ColourVision,
): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
		ungamma(v / 255),
	);
	// sRGB -> LMS
	const l = 17.8824 * r + 43.5161 * g + 4.11935 * b;
	const m = 3.45565 * r + 27.1554 * g + 3.86714 * b;
	const s = 0.0299566 * r + 0.184309 * g + 1.46709 * b;
	const [l2, m2, s2] =
		kind === 'deuteranopia'
			? [l, 0.494207 * l + 1.24827 * s, s]
			: [2.02344 * m - 2.52581 * s, m, s];
	// LMS -> sRGB
	return [
		0.080944 * l2 - 0.130504 * m2 + 0.116721 * s2,
		-0.0102485 * l2 + 0.0540194 * m2 - 0.113615 * s2,
		-0.000365294 * l2 - 0.00412163 * m2 + 0.693513 * s2,
	];
}

/** How far apart two colours remain for a dichromat, in linear-light space. */
export function dichromatDistance(
	a: string,
	b: string,
	kind: ColourVision,
): number {
	const left = simulate(a, kind);
	const right = simulate(b, kind);
	return Math.hypot(...left.map((v, i) => v - right[i]));
}
