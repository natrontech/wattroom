/**
 * "Keep my number" remembered (#1552, #1620): a suggestion is recomputed on
 * every /api/me, so a decline that lived in one component's state came back
 * on the next visit, indefinitely. Keyed on the suggested value — a NEW
 * suggestion shows again, the one you declined does not.
 *
 * Two suggestions now share this (FTP from the curve, LTHR from a hard ride)
 * and they decline independently: turning down 285 W says nothing about a
 * heart rate. One store per kind, one key each.
 */
const KEYS = {
	ftp: 'wattroom.ftp-declined.v1',
	lthr: 'wattroom.lthr-declined.v1',
} as const;

export type SuggestionKind = keyof typeof KEYS;

export function declinedSuggestion(kind: SuggestionKind): number | null {
	try {
		const value = Number(localStorage.getItem(KEYS[kind]));
		return value > 0 ? value : null;
	} catch {
		return null;
	}
}

export function declineSuggestion(
	kind: SuggestionKind,
	suggested: number,
): void {
	try {
		localStorage.setItem(KEYS[kind], String(suggested));
	} catch {
		/* the prompt comes back next visit — the same as before */
	}
}

/** Whether a suggestion is one the rider already turned down. */
export function suggestionDeclined(
	suggested: number | undefined,
	declined: number | null,
): boolean {
	return !!suggested && declined === suggested;
}
