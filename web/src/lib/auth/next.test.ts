import { beforeEach, describe, expect, it } from 'vitest';
import { rememberNext, takeNext } from './next';

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
