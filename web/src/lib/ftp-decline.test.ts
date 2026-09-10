// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { declineFtp, declinedFtp, suggestionDeclined } from './ftp-decline';

// A Map-backed store, not the environment's Storage, so this stub is the only
// thing carrying state between these tests; the same one pane.test uses.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => void store.set(key, value),
	clear: () => store.clear(),
});

describe('the declined FTP suggestion (#1552)', () => {
	beforeEach(() => localStorage.clear());

	it('is remembered across visits, for that value only', () => {
		expect(declinedFtp()).toBeNull();
		declineFtp(265);
		expect(declinedFtp()).toBe(265);
		expect(suggestionDeclined(265, declinedFtp())).toBe(true);
		// The curve grew again: a new number is a new question.
		expect(suggestionDeclined(272, declinedFtp())).toBe(false);
		expect(suggestionDeclined(undefined, declinedFtp())).toBe(false);
	});
});
