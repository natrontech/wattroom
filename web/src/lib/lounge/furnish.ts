/**
 * What a crew can put in its cozy room, and how each looks. The prices and
 * what it owns come from the server (protocol.RoomItems); the colours here
 * are fixed, so a bought rug looks the same in every theme.
 */
export const SLOTS = [
	{ slot: 'rug', name: 'Rug' },
	{ slot: 'sofa', name: 'Sofa' },
	{ slot: 'wall', name: 'Wallpaper' },
	{ slot: 'sign', name: 'Neon sign' },
] as const;

export const ITEM_NAMES: Record<string, string> = {
	'rug.forest': 'Forest',
	'rug.navy': 'Navy',
	'rug.sand': 'Sand',
	'sofa.mustard': 'Mustard',
	'sofa.forest': 'Forest',
	'sofa.rose': 'Rose',
	'wall.stripes': 'Stripes',
	'wall.plain': 'Plain',
	'sign.initial': 'Crew initial',
};

/** A rug's shadow, its colour and its line. */
export const RUGS: Record<string, readonly [string, string, string]> = {
	'rug.forest': ['#1e3a2c', '#2c5a44', '#c8b06a'],
	'rug.navy': ['#1e2a4a', '#2e4070', '#c8a24a'],
	'rug.sand': ['#7a6248', '#a08a6a', '#ece0c8'],
};

/** A sofa's ramp, shadow to top. */
export const SOFAS: Record<string, readonly [string, string, string, string]> =
	{
		'sofa.mustard': ['#7a5a1c', '#a87e2a', '#c89c3e', '#e0bc64'],
		'sofa.forest': ['#1e4234', '#2c5e4a', '#3e7e62', '#5ea084'],
		'sofa.rose': ['#6e2e44', '#94405c', '#b45e78', '#d08aa0'],
	};

export interface ShopItem {
	slot: string;
	price: number;
}
