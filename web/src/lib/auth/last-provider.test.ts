import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastProvider, rememberProvider } from './last-provider';

// Stubbed rather than leaned on: the node environment has no localStorage, and
// the throwing cases are the interesting ones anyway (same approach as
// src/lib/pane.test.ts).
function stubStorage(over: Partial<Storage> = {}) {
	const data = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => {
			data.set(k, v);
		},
		...over,
	});
}

afterEach(() => vi.unstubAllGlobals());

describe('last provider', () => {
	it('is nothing before a first sign-in', () => {
		stubStorage();
		expect(lastProvider()).toBeNull();
	});

	it('remembers the most recent one', () => {
		stubStorage();
		rememberProvider('strava');
		expect(lastProvider()).toBe('strava');
		rememberProvider('github');
		expect(lastProvider()).toBe('github');
	});

	it('survives storage refusing to write', () => {
		stubStorage({
			setItem: () => {
				throw new Error('private mode');
			},
		});
		expect(() => rememberProvider('google')).not.toThrow();
		expect(lastProvider()).toBeNull();
	});

	it('survives storage refusing to read', () => {
		stubStorage({
			getItem: () => {
				throw new Error('blocked');
			},
		});
		expect(lastProvider()).toBeNull();
	});

	it('survives there being no storage at all', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(lastProvider()).toBeNull();
		expect(() => rememberProvider('github')).not.toThrow();
	});
});
