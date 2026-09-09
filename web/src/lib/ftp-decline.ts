/**
 * "Keep my FTP" remembered (#1552): the suggestion is recomputed on every
 * /api/me, so a decline that lived in one component's state came back on
 * the next visit, indefinitely. Keyed on the suggested value — a NEW
 * suggestion shows again, the one you declined does not.
 */
const KEY = 'wattroom.ftp-declined.v1';

export function declinedFtp(): number | null {
	try {
		const value = Number(localStorage.getItem(KEY));
		return value > 0 ? value : null;
	} catch {
		return null;
	}
}

export function declineFtp(suggested: number): void {
	try {
		localStorage.setItem(KEY, String(suggested));
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
