/**
 * The mixer's one door to the device (#713). The mix is ears, not account
 * state, so it lives in `localStorage` — but nothing else in the mixer may
 * touch that global: a test substitutes this module for a Map, so what the
 * platform happens to call `localStorage` (Node ≥ 25 ships one of its own,
 * with a warning and no backing file) can never leak into the mixer's tests
 * or make two of them disagree about what is stored.
 */
const KEY = 'wattroom.mixer.v1';

export const mixerStorage = {
	/** The stored mix as JSON, or null when there is none (or no storage at all). */
	read(): string | null {
		try {
			return globalThis.localStorage?.getItem(KEY) ?? null;
		} catch {
			return null;
		}
	},
	write(json: string): void {
		try {
			globalThis.localStorage?.setItem(KEY, json);
		} catch {
			// ears-only preference; losing it costs one adjustment
		}
	},
};
