import { describe, expect, it } from 'vitest';
import { cm, keyed, keyer, KINDS, saltOf, unit, type Salt } from './keyed';
import { cosDeg, sinDeg } from './sine';

const SALT: Salt = [1, 2, 3, 4];

describe('keyed', () => {
	it('is pinned: a change here reseeds every world and every photo', () => {
		expect(keyed(SALT, 'tree', 0)).toBe(KEY_TREE_0);
		expect(keyed(SALT, 'tree', -1, 2 ** 40)).toBe(KEY_TREE_NEG_BIG);
		expect(keyed([0, 0, 0, 0], 'ground')).toBe(KEY_GROUND_EMPTY);
	});

	it('depends on the salt, the kind and every integer', () => {
		const base = keyed(SALT, 'tree', 3, 4);
		expect(keyed([1, 2, 3, 5], 'tree', 3, 4)).not.toBe(base);
		expect(keyed(SALT, 'prop', 3, 4)).not.toBe(base);
		expect(keyed(SALT, 'tree', 4, 3)).not.toBe(base);
		expect(keyed(SALT, 'tree', 3, 4, 0)).not.toBe(base);
		// Both halves of a large integer count.
		expect(keyed(SALT, 'tree', 2 ** 32)).not.toBe(keyed(SALT, 'tree', 0));
	});

	it('keys the same through a keyer', () => {
		for (const kind of KINDS) {
			const k = keyer(SALT, kind);
			for (const [a, b] of [
				[0, 0],
				[-1, 2 ** 40],
				[65003, -18231],
			]) {
				expect(k(a, b)).toBe(keyed(SALT, kind, a, b));
				expect(k(a, b, 40)).toBe(keyed(SALT, kind, a, b, 40));
			}
		}
		expect(() => keyer(SALT, 'ground')(0.5, 1)).toThrow();
	});

	it('gives every kind its own stream', () => {
		const keys = KINDS.map((k) => keyed(SALT, k, 7, 7));
		expect(new Set(keys).size).toBe(KINDS.length);
	});

	it('refuses anything but a safe integer', () => {
		expect(() => keyed(SALT, 'tree', 1.5)).toThrow();
		expect(() => keyed(SALT, 'tree', Number.NaN)).toThrow();
		expect(() => keyed(SALT, 'tree', 2 ** 53)).toThrow();
	});

	it('reads a served secret as four little-endian words', () => {
		const bytes = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
		expect(saltOf(bytes)).toEqual([
			0x04030201, 0x08070605, 0x0c0b0a09, 0x100f0e0d,
		]);
		expect(() => saltOf(new Uint8Array(15))).toThrow();
	});

	it('keys lengths by floored centimetres and fractions in [0, 1)', () => {
		expect(cm(1.239)).toBe(123);
		expect(cm(-0.001)).toBe(-1);
		expect(unit(0)).toBe(0);
		expect(unit(0xffffffff)).toBeLessThan(1);
	});
});

describe('the committed sine table', () => {
	it('holds the sine and cosine of every whole degree', () => {
		for (let d = -720; d <= 720; d++) {
			expect(sinDeg(d)).toBeCloseTo(Math.sin((d * Math.PI) / 180), 14);
			expect(cosDeg(d)).toBeCloseTo(Math.cos((d * Math.PI) / 180), 14);
		}
	});
});

const KEY_TREE_0 = 370142235;
const KEY_TREE_NEG_BIG = 1996388041;
const KEY_GROUND_EMPTY = 4003277130;
