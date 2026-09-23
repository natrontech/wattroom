/**
 * Which sidebar sections a rider has folded shut (#1359, #2570), remembered
 * per device the way the chosen crew is. The DM key predates the second
 * section and keeps its spelling, so nobody's fold springs open.
 */
export type Fold = 'dms' | 'you';

const key = (fold: Fold) => `wattroom.${fold}-folded.v1`;

export function readFolded(fold: Fold): boolean {
	try {
		return localStorage.getItem(key(fold)) === '1';
	} catch {
		return false;
	}
}

export function rememberFolded(fold: Fold, folded: boolean): void {
	try {
		localStorage.setItem(key(fold), folded ? '1' : '0');
	} catch {
		/* fine — the list is open again next time, which is the safe way to fail */
	}
}
