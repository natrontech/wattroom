// @vitest-environment happy-dom
/**
 * The test environment's own contract, not a product feature. A happy-dom test
 * must find a working `localStorage` on every Node the repo is run on: Node 26
 * ships an inert one, vitest 4's happy-dom environment declined to replace it,
 * and four green tests went red locally while CI's Node 24 stayed green
 * (#2058). vitest 5 installs the global as an accessor onto the window
 * regardless, so nothing shims it any more — which is exactly why this file
 * matters more than it did. Assert the contract here, so the next Node or
 * environment that moves a global fails one obvious test instead of an
 * arbitrary handful that look like product bugs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readDmsFolded, rememberDmsFolded } from './lib/nav/folds';
import { createProfileStore, DEFAULT_PROFILE } from './lib/profile.svelte';
import { mixerStorage } from './lib/sound/mixer-storage';

describe('the happy-dom test environment (#2058)', () => {
	it('hands a test a localStorage that stores', () => {
		localStorage.setItem('wattroom.setup.probe', 'stored');
		expect(localStorage.getItem('wattroom.setup.probe')).toBe('stored');
	});

	it('hands a test a localStorage that clears', () => {
		localStorage.setItem('wattroom.setup.probe', 'stored');
		localStorage.clear();
		expect(localStorage.getItem('wattroom.setup.probe')).toBeNull();
	});
});

/**
 * The four loud tests of #2058 were the better half. Every other storage-backed
 * module answers a missing `localStorage` with its default — a `typeof` guard, a
 * swallowed `catch`, an optional chain — so a suite that lost storage entirely
 * would still be green while asserting nothing but the defaults. A green run is
 * therefore no evidence that the storage path ran at all.
 *
 * So assert the round trip itself, once per guard shape in the codebase, and
 * pair it with the same round trip under Node 26's inert global: the negative
 * control is what makes the positive one worth reading. Written for the vitest 5
 * upgrade (#2346), where the environment machinery is exactly what changed.
 */
describe('a storage-backed module reaches storage, not its default (#2346)', () => {
	/** Node 26's shape: an own global that evaluates to undefined. */
	function withoutStorage<T>(body: () => T): T {
		const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		Object.defineProperty(globalThis, 'localStorage', {
			value: undefined,
			configurable: true,
			writable: true,
		});
		try {
			return body();
		} finally {
			if (real) Object.defineProperty(globalThis, 'localStorage', real);
			else Reflect.deleteProperty(globalThis, 'localStorage');
		}
	}

	// Guarded, so that in a broken environment these tests fail on the round trip
	// they are about rather than on the fixture — "expected false to be true"
	// names the silent default a rider would have got, where a throwing
	// `clear()` only names the global.
	beforeEach(() => globalThis.localStorage?.clear());

	// profile.svelte.ts: `if (typeof localStorage === 'undefined') return default`.
	it('reads an FTP back through a fresh profile store', () => {
		expect(createProfileStore().update({ ftp: 313 })).toBeNull();
		expect(createProfileStore().current.ftp).toBe(313);
		expect(createProfileStore().current.ftp).not.toBe(DEFAULT_PROFILE.ftp);
	});

	// nav/folds.ts: a bare `localStorage.getItem` inside a swallowing `catch`.
	it('reads a folded sidebar section back', () => {
		expect(readDmsFolded()).toBe(false);
		rememberDmsFolded(true);
		expect(readDmsFolded()).toBe(true);
	});

	// sound/mixer-storage.ts: `globalThis.localStorage?.getItem`.
	it('reads the stored mix back', () => {
		expect(mixerStorage.read()).toBeNull();
		mixerStorage.write('{"music":0}');
		expect(mixerStorage.read()).toBe('{"music":0}');
	});

	/**
	 * The negative control for all three above: same writes, same reads, storage
	 * taken away between them. Every one answers with its default and none of
	 * them raises — which is the silent half of #2058, reproduced on purpose.
	 */
	it('answers with defaults, silently, when the platform global is inert', () => {
		expect(createProfileStore().update({ ftp: 313 })).toBeNull();
		rememberDmsFolded(true);
		mixerStorage.write('{"music":0}');

		withoutStorage(() => {
			expect(typeof localStorage).toBe('undefined');
			expect(createProfileStore().current.ftp).toBe(DEFAULT_PROFILE.ftp);
			expect(readDmsFolded()).toBe(false);
			expect(mixerStorage.read()).toBeNull();
		});

		// And the storage was there all along, so the fallbacks above happened
		// for want of the global rather than for want of a write.
		expect(createProfileStore().current.ftp).toBe(313);
		expect(readDmsFolded()).toBe(true);
		expect(mixerStorage.read()).toBe('{"music":0}');
	});
});
