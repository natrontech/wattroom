/**
 * The lounge's colours (ADR-0094, amended by #4302): two hand-set rooms, one
 * per scheme, turned to the rider's theme. Every material is a ramp from its
 * shadow to its light (`woodDark`, `wood`, `woodLight`, `woodTop`), lit from
 * the top left, and outlined in `ink`. The walls, the sofa and the curtains
 * follow the theme's neon; wood, the floor and the rug stay warm against
 * them, as do the light outside the window, skin, leaves, cushions and the
 * lamp's amber. The one live number takes the theme's watt.
 */
import { hexToOklch, normalizeHue, oklchToHex } from '$lib/color';
import type { Theme } from '$lib/palette';

const DARK = {
	ink: '#08010f',
	wallDark: '#100428',
	wall: '#170838',
	wallLight: '#21104a',
	trim: '#2e1460',
	floorDark: '#1d1016',
	floor: '#2a171b',
	floorLight: '#301b1e',
	woodDark: '#33190f',
	wood: '#54301c',
	woodLight: '#7a4a2a',
	woodTop: '#a06a3c',
	sofaDark: '#171c52',
	sofa: '#252d78',
	sofaLight: '#34409a',
	sofaTop: '#4a58b8',
	rugDark: '#4a1a22',
	rug: '#6c2a2c',
	rugLine: '#c8894a',
	curtainDark: '#28104a',
	curtain: '#3a1a66',
	frame: '#8b2bff',
	screen: '#0b0620',
	laptop: '#26114a',
	laptopLight: '#3a1d6a',
	pantsDark: '#1b1638',
	pants: '#2b2350',
	teal: '#3de0d0',
	tealLight: '#9ff5ec',
	amberDark: '#c27a2c',
	amber: '#ffd27a',
	bulb: '#ffe2a8',
	lilac: '#c9b8ff',
	violet: '#8b6cff',
	cat: '#3b3552',
	catLight: '#55507a',
	grid: '#5a1fb0',
	ground: '#0d0224',
	mountain: '#1f0745',
	city: '#12032e',
	rain: '#7a66e0',
	snow: '#e8e0ff',
	leafDark: '#1b5e4a',
	leaf: '#2a8a6a',
	leafLight: '#3fbf8a',
	heart: '#ffb3a0',
	towel: '#3de0d0',
	paper: '#f0ecff',
	shade: '#05000d',
	poster: '#12042c',
	shelf: '#24095a',
	book: '#43127a',
	bookB: '#2a6a8a',
	bookC: '#7a2a5a',
	cable: '#6a5a96',
	speaker: '#1f0b40',
	star: '#ffffff',
	shirt: '#8b6cff',
	cushionA: '#8a3a6a',
	cushionB: '#2a6a7a',
	cushionC: '#8a6a2a',
	cushionD: '#5a3a84',
	/** The chalkboard's slate and the corkboard. */
	slate: '#1f3a33',
	cork: '#a8763f',
	corkDark: '#7f5429',
	/** A workshop's red: the tool chest, the machine's gauge. */
	red: '#b83a32',
	redLight: '#dc6a4e',
	/** Where the stove's light flickers on the floor. */
	litFloor: '#5a3424',
	/** What light is, on its way into the room (light.ts). */
	glow: '#ffb45e',
	moon: '#7f8ff0',
	watt: '#ff3d8b',
};

export type LoungeColours = typeof DARK;
type Name = keyof LoungeColours;

/** Daylight in the same room: pale walls, mid-tone wood, dark only where things are ink. */
const LIGHT: LoungeColours = {
	...DARK,
	ink: '#24123f',
	wallDark: '#ddd0f0',
	wall: '#ece3f8',
	wallLight: '#f6f1fd',
	trim: '#b7a2db',
	floorDark: '#b08a64',
	floor: '#c9a67e',
	floorLight: '#cfad86',
	woodDark: '#7a4e2e',
	wood: '#9a6a42',
	woodLight: '#b98a5e',
	woodTop: '#d6ab7e',
	sofaDark: '#4554a8',
	sofa: '#5f6fc8',
	sofaLight: '#7a8ad8',
	sofaTop: '#9eacea',
	rugDark: '#a8553f',
	rug: '#c4705a',
	rugLine: '#f0d7a8',
	curtainDark: '#8a6cc4',
	curtain: '#a58ad6',
	frame: '#6f1ad1',
	screen: '#24123f',
	laptop: '#57408a',
	laptopLight: '#6e58a2',
	pantsDark: '#3a2d60',
	pants: '#4f3f7a',
	teal: '#11a596',
	tealLight: '#6fded2',
	amberDark: '#c27a14',
	amber: '#f2ab33',
	bulb: '#ffd27a',
	lilac: '#8a72d6',
	violet: '#6a4be0',
	cat: '#57516e',
	catLight: '#7c769c',
	leafDark: '#23765a',
	leaf: '#2f9a74',
	leafLight: '#4bc490',
	paper: '#ffffff',
	shade: '#1a0b33',
	poster: '#f8f4ff',
	shelf: '#d3c2ee',
	book: '#9a7bd0',
	bookB: '#4a9ab8',
	bookC: '#c0609a',
	cable: '#7a68a8',
	speaker: '#cdbbe9',
	shirt: '#6a4be0',
	cushionA: '#c0608e',
	cushionB: '#3f97a6',
	cushionC: '#d0a040',
	cushionD: '#8a68c8',
	litFloor: '#e8c49a',
	glow: '#ffc27a',
	moon: '#a8b4f0',
	watt: '#e6247d',
};

/** What keeps its hue whatever the theme: wood, floor, rug, skin, leaves, lamp light, cushions and the odd book. */
const FIXED: readonly Name[] = [
	'floorDark',
	'floor',
	'floorLight',
	'woodDark',
	'wood',
	'woodLight',
	'woodTop',
	'rugDark',
	'rug',
	'rugLine',
	'teal',
	'tealLight',
	'amberDark',
	'amber',
	'bulb',
	'leafDark',
	'leaf',
	'leafLight',
	'heart',
	'towel',
	'paper',
	'star',
	'bookB',
	'bookC',
	'cushionA',
	'cushionB',
	'cushionC',
	'slate',
	'cork',
	'corkDark',
	'red',
	'redLight',
	'litFloor',
	'glow',
	'moon',
	'watt',
];

/** Five bands from the top of the sky to the horizon. */
const BASE_SKIES = {
	night: ['#0b0220', '#1a0646', '#2e0b66', '#4a1380', '#6b1f8f'],
	dusk: ['#24095a', '#43127a', '#6a1f86', '#9a3a7e', '#d0705e'],
	day: ['#3a3fb0', '#4f5cc4', '#7076d2', '#9a8fd8', '#cfa2d0'],
} as const;
export type Sky = keyof typeof BASE_SKIES;

/** The sun's upper and lower halves under each sky. */
export const SUNS: Record<Sky, readonly [string, string]> = {
	night: ['#e0905a', '#c0506a'],
	dusk: ['#ffb347', '#ff7a59'],
	day: ['#ffe08a', '#ffb347'],
};

/** The colours the scene draws with right now; applyLoungeTheme repaints them. */
export const LOUNGE: LoungeColours = { ...DARK };
export const SKIES: Record<Sky, string[]> = {
	night: [...BASE_SKIES.night],
	dusk: [...BASE_SKIES.dusk],
	day: [...BASE_SKIES.day],
};
let applied = '';

function turned(hex: string, by: number): string {
	if (!by) return hex;
	const c = hexToOklch(hex);
	return oklchToHex({ ...c, h: normalizeHue(c.h + by) });
}

/**
 * Repaint the room for a theme. Returns whether anything changed, so the
 * caller can drop what it cached under the old colours.
 */
export function applyLoungeTheme(theme: Theme): boolean {
	if (theme.id === applied) return false;
	applied = theme.id;
	const base = theme.family === 'light' ? LIGHT : DARK;
	const by = hexToOklch(theme.tokens.neon).h - hexToOklch(base.frame).h;
	for (const name of Object.keys(base) as Name[])
		LOUNGE[name] = FIXED.includes(name) ? base[name] : turned(base[name], by);
	LOUNGE.frame = theme.tokens.neon;
	LOUNGE.watt = theme.tokens.watt;
	for (const kind of Object.keys(BASE_SKIES) as Sky[])
		SKIES[kind] = BASE_SKIES[kind].map((c) => turned(c, by));
	return true;
}

/** The viewer's hour, as the window sees it. */
export function skyAt(hour: number): Sky {
	if (hour >= 9 && hour < 17) return 'day';
	if ((hour >= 6 && hour < 9) || (hour >= 17 && hour < 20)) return 'dusk';
	return 'night';
}

const shades = new Map<string, string>();

/** A colour's shadow step: darker, a touch more saturated, as the ramps are. */
export function shadeOf(hex: string): string {
	let made = shades.get(hex);
	if (!made) {
		const c = hexToOklch(hex);
		made = oklchToHex({ ...c, l: Math.max(0, c.l - 0.09), c: c.c * 1.08 });
		shades.set(hex, made);
	}
	return made;
}

/**
 * Skin for a figure, lightest to darkest (look.ts). A rider who picked none
 * is seeded from the first six by their id, as before the last two came.
 */
export const SKINS = [
	'#f1c7a5',
	'#e0ac85',
	'#c68a62',
	'#a8714a',
	'#8d5a3c',
	'#5e3a26',
	'#4a2e22',
	'#2e1d17',
];
/** Hair colours; a seeded look takes one of the first six. */
export const HAIRS = [
	'#2a1a12',
	'#0f0a0a',
	'#d9b25a',
	'#a8442a',
	'#6b4a2e',
	'#c9c2d6',
	'#f0ece8',
	'#e86aa8',
	'#8b6cff',
	'#5aa0e8',
	'#3fbf8a',
];
/** Short, long, a bun, a beanie, then the editor's: a mohawk, curls, a ponytail, bald, an afro, braids, a side part, a top knot. */
export const HAIR_STYLES = 12;
export const CUSHIONS = [
	'cushionA',
	'cushionB',
	'cushionC',
	'cushionD',
] as const;
