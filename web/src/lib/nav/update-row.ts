/**
 * What the sidebar's foot says about updates (#2588): one thing, the most
 * urgent first — the app installing itself, a desktop update downloaded and
 * waiting for a restart, one it could not fetch by itself, a newer WattRoom
 * live than this window runs, then a release not yet read. Nothing at all
 * when there is nothing, so the row is never an ornament.
 */
export type UpdateRowState =
	| { kind: 'installing' }
	| { kind: 'desktop'; version: string }
	| { kind: 'manual'; version: string }
	| { kind: 'live'; version: string }
	| { kind: 'release'; version: string; changes: number };

export function updateRowState(s: {
	installing: boolean;
	/** The desktop update the shell has downloaded. */
	downloaded: string | null;
	/** A newer desktop build this shell cannot fetch by itself. */
	manual: string | null;
	/** The server's version, when it is not the one this window loaded. */
	live: string | null;
	unseen: { version: string; changes: number } | null;
}): UpdateRowState | null {
	if (s.installing) return { kind: 'installing' };
	if (s.downloaded) return { kind: 'desktop', version: s.downloaded };
	if (s.manual) return { kind: 'manual', version: s.manual };
	if (s.live) return { kind: 'live', version: s.live };
	if (s.unseen) return { kind: 'release', ...s.unseen };
	return null;
}
