import { beforeEach, describe, expect, it } from 'vitest';
import { landing, rememberNext, takeNext } from './next';

// vitest runs in node; the stash only needs get/set/remove, so a Map is the
// stub — same pattern as profile.test.ts (node's own webstorage global is
// version-dependent, so never rely on it).
const stored = new Map<string, string>();
globalThis.sessionStorage = {
	getItem: (key: string) => stored.get(key) ?? null,
	setItem: (key: string, value: string) => void stored.set(key, value),
	removeItem: (key: string) => void stored.delete(key),
	clear: () => stored.clear(),
	key: () => null,
	length: 0,
} as Storage;

describe('login next-stash', () => {
	beforeEach(() => stored.clear());

	it('round-trips a same-origin path and clears it', () => {
		rememberNext('/r/velvet-hammer?tab=medals');
		expect(takeNext()).toBe('/r/velvet-hammer?tab=medals');
		expect(takeNext()).toBeNull();
	});

	it('drops open redirects and junk', () => {
		for (const bad of [
			'//evil.example',
			'/\\evil.example', // the backslash form, folded to // by the parser (#1610)
			'/\\\\evil.example',
			'https://evil.example/x',
			'javascript:alert(1)',
			'',
			null,
		]) {
			rememberNext(bad);
			expect(takeNext()).toBeNull();
		}
	});

	it('a later junk value clears an earlier good one', () => {
		rememberNext('/rooms');
		rememberNext('//evil.example');
		expect(takeNext()).toBeNull();
	});
});

describe('landing', () => {
	it('follows the invite the account still holds (#2144)', () => {
		expect(landing('AB23CD')).toBe('/c/AB23CD');
	});
	it('is Home with none', () => {
		expect(landing(undefined)).toBe('/home');
		expect(landing(null)).toBe('/home');
		expect(landing('')).toBe('/home');
	});

	// Since ADR-0058 Home is the You mode, so every start opened in You (#2576).
	const crews = [{ id: 'c1' }, { id: 'c2' }];
	it('opens in the crew the sidebar would choose', () => {
		expect(landing(null, 'c2', crews)).toBe('/crew/c2');
	});
	it('is Home when that crew is gone, or You was chosen', () => {
		expect(landing(null, 'left', crews)).toBe('/home');
		expect(landing(null, 'you', crews)).toBe('/home');
		expect(landing(null, null, crews)).toBe('/home');
	});
	it('still follows an invite first', () => {
		expect(landing('AB23CD', 'c1', crews)).toBe('/c/AB23CD');
	});
});
