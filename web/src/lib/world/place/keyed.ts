/**
 * Every choice the world makes is keyed (#3224): a hash of a secret salt, the
 * kind of decision and a few integers — never a stream that earlier choices
 * advance. So a cell decides the same thing whatever else was built first,
 * on a worker or the main thread, in any engine, and in Go.
 *
 * Only IEEE-exact operations: Math.imul, shifts, xor, floor and the four
 * arithmetic operators. The salt is always a parameter — a salt compiled
 * into the bundle is public, and a public salt matches a photo to its place
 * (#3225 serves them).
 */

/** The decisions a key may be for. Closed: two kinds never share a stream. */
export const KINDS = [
	'ground',
	'biome',
	'tree',
	'prop',
	'house',
	'setpiece',
	'sign',
	'name',
] as const;
export type Kind = (typeof KINDS)[number];

/** 128 bits, as four unsigned 32-bit words. */
export type Salt = readonly [number, number, number, number];

/** A served secret's first 16 bytes, little-endian words. */
export function saltOf(secret: Uint8Array): Salt {
	if (secret.length < 16) throw new Error('a salt needs 16 bytes');
	const v = new DataView(secret.buffer, secret.byteOffset, 16);
	return [
		v.getUint32(0, true),
		v.getUint32(4, true),
		v.getUint32(8, true),
		v.getUint32(12, true),
	];
}

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;
const TWO_32 = 4294967296;

function mix(h: number, k: number): number {
	k = Math.imul(k, C1);
	k = (k << 15) | (k >>> 17);
	k = Math.imul(k, C2);
	h ^= k;
	h = (h << 13) | (h >>> 19);
	return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/**
 * The key for one decision: murmur3's block mix over the salt, the kind and
 * each integer (a safe integer, in two 32-bit halves), then its finaliser.
 */
export function keyed(salt: Salt, kind: Kind, ...ints: number[]): number {
	let h = 0;
	for (const word of salt) h = mix(h, word);
	h = mix(h, KINDS.indexOf(kind));
	for (const n of ints) {
		if (!Number.isSafeInteger(n)) throw new Error(`not an integer: ${n}`);
		h = mix(h, n | 0);
		h = mix(h, Math.floor(n / TWO_32) | 0);
	}
	h ^= 4 * (5 + 2 * ints.length);
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return h >>> 0;
}

/** A key as a fraction in [0, 1). */
export const unit = (key: number): number => key / TWO_32;

/** Metres as whole centimetres, floored: the only way a length enters a key. */
export const cm = (metres: number): number => Math.floor(metres * 100);
