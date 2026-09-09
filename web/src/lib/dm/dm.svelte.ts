/**
 * The open DM thread (#208) — module state so any surface (friends panel,
 * member popout) can open it and the one drawer follows. "Seen" is purely
 * the reader's own business: a localStorage stamp per peer, never a server
 * fact (ADR-0012 amended).
 */
const SEEN_PREFIX = 'wattroom.dm.seen.';

let open = $state<{ id: string; name: string } | null>(null);

export const dm = {
	get open() {
		return open;
	},
	// Neither stamps "seen" (#1819): opening a thread is not reading it. The
	// thread store stamps when lines actually arrived in a visible tab, which
	// is the one condition under which the rider could have seen them.
	show(id: string, name: string) {
		open = { id, name };
	},
	close() {
		open = null;
	},
	stampSeen(peerId: string) {
		try {
			localStorage.setItem(SEEN_PREFIX + peerId, String(Date.now()));
		} catch {
			/* fine — the badge just stays */
		}
	},
	seenAt(peerId: string): number {
		try {
			return Number(localStorage.getItem(SEEN_PREFIX + peerId) ?? 0);
		} catch {
			return 0;
		}
	},
};
