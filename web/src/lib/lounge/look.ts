/**
 * What a rider wears in the cozy room, put together from parts in the
 * lounge's editor (LookEditor) and kept as one base-36 character per part, in
 * PARTS order: the server keeps the string's shape and the roster carries it.
 * A rider who picked nothing, or a character this build does not know, wears
 * the part seeded from their id, so every screen dresses them alike.
 */
import { HAIRS, SKINS } from '#lib/lounge/palette.ts';
import { fnv } from '#lib/world/loadout.ts';

/** What a top, trousers, shoes, a cap or a scarf may be dyed. */
export const CLOTHES = [
	{ name: 'Violet', hex: '#8b6cff' },
	{ name: 'Teal', hex: '#3de0d0' },
	{ name: 'Sun', hex: '#ffd27a' },
	{ name: 'Coral', hex: '#ff8a6a' },
	{ name: 'Red', hex: '#d8404a' },
	{ name: 'Rose', hex: '#e86aa8' },
	{ name: 'Sky', hex: '#5aa0e8' },
	{ name: 'Navy', hex: '#2b3a7a' },
	{ name: 'Forest', hex: '#2a8a6a' },
	{ name: 'Olive', hex: '#7a8a3a' },
	{ name: 'Cream', hex: '#f0e6d0' },
	{ name: 'Grey', hex: '#7a7488' },
	{ name: 'Black', hex: '#1a1424' },
] as const;

export const HAIR_NAMES = [
	'Short',
	'Long',
	'Bun',
	'Beanie',
	'Mohawk',
	'Curls',
	'Ponytail',
	'Bald',
	'Afro',
	'Braids',
	'Side part',
	'Top knot',
] as const;
export const TOPS = [
	'Tee',
	'Hoodie',
	'Jersey',
	'Sweater',
	'Vest',
	'Rain jacket',
] as const;
export const GLASSES = ['None', 'Round', 'Shades'] as const;
export const BEARDS = ['None', 'Stubble', 'Moustache', 'Beard'] as const;
export const BADGES = ['None', 'Star', 'Heart', 'Bolt'] as const;
export const PETS = ['None', 'Dog', 'Parrot', 'Hamster'] as const;

/**
 * Every part, in the order the string keeps them, and how many choices it
 * has. A dyed part's 0 is its default (the road jersey's colour, the room's
 * trousers, dark shoes, no cap, no scarf, no socks), then CLOTHES in order.
 * New parts go at the end: a string written before them still reads.
 */
export const PARTS = {
	skin: SKINS.length,
	hair: HAIR_NAMES.length,
	hairColour: HAIRS.length,
	top: TOPS.length,
	topColour: CLOTHES.length + 1,
	stripes: 2,
	trousers: CLOTHES.length + 1,
	shoes: CLOTHES.length + 1,
	glasses: GLASSES.length,
	cap: CLOTHES.length + 1,
	scarf: CLOTHES.length + 1,
	beard: BEARDS.length,
	badge: BADGES.length,
	pet: PETS.length,
	socks: CLOTHES.length + 1,
} as const;
export type Part = keyof typeof PARTS;
export type Look = Record<Part, number>;
const ORDER = Object.keys(PARTS) as Part[];

/**
 * The look seeded from a rider's id: what everyone wore before the editor,
 * drawn from the swatches there were then, in a jersey the road's colour.
 */
export function seededLook(id: string): Look {
	const seed = fnv(id);
	return {
		skin: seed % 6,
		hair: (seed >>> 12) % 4,
		hairColour: (seed >>> 8) % 6,
		top: 2,
		topColour: 0,
		stripes: 0,
		trousers: 0,
		shoes: 0,
		glasses: 0,
		cap: 0,
		scarf: 0,
		beard: 0,
		badge: 0,
		pet: 0,
		socks: 0,
	};
}

/** A rider's look: what they picked, the seeded part wherever they picked nothing this build knows. */
export function lookOf(id: string, text?: string): Look {
	const look = seededLook(id);
	ORDER.forEach((part, i) => {
		const n = parseInt(text?.[i] ?? '', 36);
		if (n >= 0 && n < PARTS[part]) look[part] = n;
	});
	return look;
}

export const encodeLook = (look: Look): string =>
	ORDER.map((part) => look[part].toString(36)).join('');

/** Any look at all: the editor's dice. */
export function shuffledLook(r: () => number = Math.random): Look {
	return Object.fromEntries(
		ORDER.map((part) => [part, Math.floor(r() * PARTS[part])]),
	) as Look;
}

/** A dyed part's colour, or `fallback` for its 0. */
export const dyed = (n: number, fallback: string): string =>
	n > 0 ? CLOTHES[n - 1].hex : fallback;
