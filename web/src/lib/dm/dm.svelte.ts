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
	show(id: string, name: string) {
		open = { id, name };
		this.stampSeen(id);
	},
	close() {
		if (open) this.stampSeen(open.id);
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
