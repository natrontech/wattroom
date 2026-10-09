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

/**
 * Jerseys nearer than this read as one colour from the chase camera (#3791):
 * lime and sun, enzian and alpine. It is the widest band the palette can
 * always keep a jersey clear of four others: as many as a five-lane row seats
 * ahead of you.
 */
export const JERSEY_BAND = 0.16;
const clearOf = (jersey: string, worn: readonly string[]) =>
	worn.every(
		(w) => perceptualDistance(hexOf.get(jersey)!, hexOf.get(w)!) > JERSEY_BAND,
	);

/** A look for a rider who has chosen none: seeded from their id, so every screen dresses them alike. */
export function seededLoadout(id: string): Loadout {
	return seeded(id, [], 1);
}

/**
 * A seeded look whose jersey keeps clear of `worn`, the jerseys of everyone
 * who joined before: of all of them where the palette allows, and always of
 * the `abreast - 1` just before, whom a row can seat beside it. A jersey
 * already clear is kept, so with nobody before it this is the rider's own look.
 */
function seeded(id: string, worn: readonly string[], abreast: number): Loadout {
	const r = prng(fnv(id, 0x9e3779b9));
	const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
	const apart = (than: string, from = CLOTH) =>
		pick(
			from.filter(
				(c) => perceptualDistance(hexOf.get(c)!, hexOf.get(than)!) > 0.18,
			),
		);
	let a = pick(CLOTH);
	for (const before of [
		worn,
		worn.slice(Math.max(0, worn.length - abreast + 1)),
	]) {
		if (clearOf(a, before)) break;
		const free = CLOTH.filter((c) => clearOf(c, before));
		if (free.length) {
			a = pick(free);
			break;
		}
	}
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

/** Who rides a road together, in the order they joined, and the look they chose, if any. */
export type Wearer = { id: string; look?: Loadout };

/**
 * Everyone's look on a road together (#3791): a chosen look as chosen, and a
 * seeded one clear of the jerseys ridden by those who joined before. Read in
 * the join order every screen shares, it dresses everyone alike on every
 * screen, and a rider joining never changes the look of anyone before them.
 * `abreast` is the most riders a row of the bunch seats side by side.
 */
export function bunchLooks(
	riders: readonly Wearer[],
	abreast: number,
): Map<string, Loadout> {
	const looks = new Map<string, Loadout>();
	const worn: string[] = [];
	for (const { id, look } of riders) {
		const l = look ?? seeded(id, worn, abreast);
		looks.set(id, l);
		const jersey = String(l.colours?.jerseyA ?? STARTER.colours?.jerseyA);
		if (hexOf.has(jersey)) worn.push(jersey);
	}
	return looks;
}
