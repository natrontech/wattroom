/**
 * The lounge's colours (ADR-0094, amended by #4302): two hand-set rooms, one
 * per scheme, turned to the rider's theme. The room's hues follow the theme's
 * neon; the light outside the window, skin, leaves and the lamp's amber stay
 * what they are. The one live number takes the theme's watt.
 */
import { hexToOklch, normalizeHue, oklchToHex } from '$lib/color';
import type { Theme } from '$lib/palette';

const DARK = {
	wall: '#170838',
	wainscot: '#1a0940',
	trim: '#2b0f55',
	floor: '#0f0526',
	plank: '#1a0a3a',
	frame: '#8b2bff',
	sillTop: '#3d1872',
	wood: '#3a1d5c',
	woodLight: '#4a2a70',
	cushion: '#5a3a84',
	ink: '#08010f',
	screen: '#0b0620',
	laptop: '#26114a',
	teal: '#3de0d0',
	tealLight: '#9ff5ec',
	amber: '#ffd27a',
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
	leaf: '#2a8a6a',
	leafLight: '#3fbf8a',
	heart: '#ffb3a0',
	towel: '#3de0d0',
	paper: '#f0ecff',
	shade: '#05000d',
	legFar: '#2b1f4a',
	legNear: '#3a2a5c',
	poster: '#12042c',
	shelf: '#24095a',
	book: '#43127a',
	bookB: '#2a6a8a',
	bookC: '#7a2a5a',
	rug: '#3a2a5c',
	cable: '#6a5a96',
	door: '#1f0b40',
	star: '#ffffff',
	shirt: '#8b6cff',
	beam: '#120630',
	bulb: '#ffe2a8',
	watt: '#ff3d8b',
};

export type LoungeColours = typeof DARK;
type Name = keyof LoungeColours;

/** Daylight in the same room: pale walls, mid-tone wood, dark only where things are ink. */
const LIGHT: LoungeColours = {
	...DARK,
	wall: '#ece3f8',
	wainscot: '#ddd0f0',
	trim: '#b7a2db',
	floor: '#c8b4e2',
	plank: '#b39cd6',
	frame: '#6f1ad1',
	sillTop: '#f8f3ff',
	wood: '#8e6cbc',
	woodLight: '#a88ad2',
	cushion: '#8462c0',
	ink: '#24123f',
	screen: '#24123f',
	laptop: '#57408a',
	teal: '#11a596',
	tealLight: '#6fded2',
	amber: '#f2ab33',
	lilac: '#8a72d6',
	violet: '#6a4be0',
	cat: '#57516e',
	catLight: '#7c769c',
	leaf: '#2f9a74',
	leafLight: '#4bc490',
	paper: '#ffffff',
	shade: '#1a0b33',
	legFar: '#4f3f7a',
	legNear: '#655495',
	poster: '#f8f4ff',
	shelf: '#d3c2ee',
	book: '#9a7bd0',
	bookB: '#4a9ab8',
	bookC: '#c0609a',
	rug: '#b29ad8',
	cable: '#7a68a8',
	door: '#cdbbe9',
	shirt: '#6a4be0',
	beam: '#d4c4ec',
	bulb: '#ffd27a',
	watt: '#e6247d',
};

/** What keeps its hue whatever the theme: skin, leaves, lamp light, the sign and the odd book. */
const FIXED: readonly Name[] = [
	'teal',
	'tealLight',
	'amber',
	'leaf',
	'leafLight',
	'heart',
	'towel',
	'paper',
	'star',
	'bulb',
	'bookB',
	'bookC',
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

/** Skin for a figure: a fixed set, picked by the rider's id. */
export const SKINS = [
	'#f1c7a5',
	'#e0ac85',
	'#c68a62',
	'#a8714a',
	'#8d5a3c',
	'#5e3a26',
];
export const HAIRS = [
	'#2a1a12',
	'#0f0a0a',
	'#d9b25a',
	'#a8442a',
	'#6b4a2e',
	'#c9c2d6',
];
