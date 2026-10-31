/**
 * The lounge's colours (ADR-0094): a picture's token family beside the
 * world's, which may hold hues past the app's two accents. The one live
 * number on it takes the watt hue from the theme, never from here.
 */
export const LOUNGE = {
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
	rug: '#3a2a5c',
	cable: '#6a5a96',
	door: '#1f0b40',
	star: '#ffffff',
	shirt: '#8b6cff',
	/** Until the theme's --color-watt has been read off the canvas. */
	watt: '#ff3d8b',
} as const;

/** Five bands from the top of the sky to the horizon. */
export const SKIES = {
	night: ['#0b0220', '#1a0646', '#2e0b66', '#4a1380', '#6b1f8f'],
	dusk: ['#24095a', '#43127a', '#6a1f86', '#9a3a7e', '#d0705e'],
	day: ['#3a3fb0', '#4f5cc4', '#7076d2', '#9a8fd8', '#cfa2d0'],
} as const;
export type Sky = keyof typeof SKIES;

/** The sun's upper and lower halves under each sky. */
export const SUNS: Record<Sky, readonly [string, string]> = {
	night: ['#e0905a', '#c0506a'],
	dusk: ['#ffb347', '#ff7a59'],
	day: ['#ffe08a', '#ffb347'],
};

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
