// A look for a rider who has chosen none (#3156), apart from three.js so a
// route can seed one without pulling the world into its chunk.
import { hexToOklch, perceptualDistance } from '$lib/color';
import { catalogue } from '$lib/wardrobe/catalogue';
import { PATTERNS } from './figure/jersey';
import { prng } from './rand';

/** A wardrobe loadout as the server keeps it: an item id per slot, beside the free choices. */
export type Loadout = {
	[slot: string]: unknown;
	colours?: Record<string, string>;
	params?: Record<string, unknown>;
	skin?: string;
};

export const STARTER = catalogue.starterLoadout as Loadout;
export const hexOf = new Map<string, string>([
	...catalogue.palette.map((p) => [p.id, p.hex] as const),
	...catalogue.skinTones.map((s) => [s.id, s.hex] as const),
]);

/** FNV-1a over a string: the seed for everything a rider wears and is drawn as. */
export function fnv(id: string, h = 2166136261): number {
	for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
	return h >>> 0;
}

/** The jerseys a seeded look may wear: the patterns the figure draws, as the catalogue sells or gives them. */
const SEEDED_JERSEYS = catalogue.items.filter(
	(i) =>
		i.slot === 'jersey' &&
		PATTERNS.includes(i.pattern as (typeof PATTERNS)[number]) &&
		!i.unlock &&
		!i.crewOnly,
);
/** The colours a seeded look picks from, and the darks its shorts take. */
const KIT_COLOURS = catalogue.palette.map((p) => p.id);
const DARKS = ['ink', 'graphite', 'night', 'slate'];
/** Jersey colours that never read as bare skin: clear of every skin tone and of the neutral figure's mid grey. */
const CLOTH = KIT_COLOURS.filter((id) => {
	const hex = hexOf.get(id)!;
	const k = hexToOklch(hex);
	return (
		catalogue.skinTones.every((s) => perceptualDistance(hex, s.hex) > 0.08) &&
		!(k.c < 0.04 && k.l > 0.45 && k.l < 0.8)
	);
});

/** A look for a rider who has chosen none: seeded from their id, so every screen dresses them alike. */
export function seededLoadout(id: string): Loadout {
	const r = prng(fnv(id, 0x9e3779b9));
	const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
	const apart = (than: string, from = CLOTH) =>
		pick(
			from.filter(
				(c) => perceptualDistance(hexOf.get(c)!, hexOf.get(than)!) > 0.18,
			),
		);
	const a = pick(CLOTH);
	const b = apart(a);
	return {
		...STARTER,
		jersey: pick(SEEDED_JERSEYS).id,
		skin: undefined,
		colours: {
			...STARTER.colours,
			jerseyA: a,
			jerseyB: b,
			jerseyC: apart(b),
			shorts: pick(DARKS),
			shortsAccent: a,
			// Never the hair's colour: from behind, a helmet must read as a helmet.
			helmet: apart(String(STARTER.colours?.hair), KIT_COLOURS),
			socks: pick(['snow', 'ink', b]),
			sockAccent: a,
			frame: pick([...DARKS, a]),
			frameAccent: b,
			decal: b,
		},
	};
}
