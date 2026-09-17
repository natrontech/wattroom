// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	declineSuggestion,
	declinedSuggestion,
	suggestionDeclined,
} from './suggestion-decline';

// A Map-backed store, not the environment's Storage, so this stub is the only
// thing carrying state between these tests; the same one pane.test uses.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => void store.set(key, value),
	clear: () => store.clear(),
});

describe('a declined suggestion (#1552, #1620)', () => {
	beforeEach(() => localStorage.clear());

	it('is remembered across visits, for that value only', () => {
		expect(declinedSuggestion('ftp')).toBeNull();
		declineSuggestion('ftp', 265);
		expect(declinedSuggestion('ftp')).toBe(265);
		expect(suggestionDeclined(265, declinedSuggestion('ftp'))).toBe(true);
		// The curve grew again: a new number is a new question.
		expect(suggestionDeclined(272, declinedSuggestion('ftp'))).toBe(false);
		expect(suggestionDeclined(undefined, declinedSuggestion('ftp'))).toBe(
			false,
		);
	});

	it('keeps the two kinds apart', () => {
		// Turning down an FTP says nothing about a heart rate, and the two
		// numbers overlap in range — 168 is a plausible either.
		declineSuggestion('ftp', 168);
		expect(declinedSuggestion('lthr')).toBeNull();
		expect(suggestionDeclined(168, declinedSuggestion('lthr'))).toBe(false);
		declineSuggestion('lthr', 172);
		expect(declinedSuggestion('ftp')).toBe(168);
		expect(declinedSuggestion('lthr')).toBe(172);
	});
});
