/**
 * Which sidebar sections a rider has folded shut (#1359), remembered per
 * device the way the chosen crew is. ponytail: one key for the one section
 * that folds; a map keyed by section if a second one ever does.
 */
const DMS = 'wattroom.dms-folded.v1';

export function readDmsFolded(): boolean {
	try {
		return localStorage.getItem(DMS) === '1';
	} catch {
		return false;
	}
}

export function rememberDmsFolded(folded: boolean): void {
	try {
		localStorage.setItem(DMS, folded ? '1' : '0');
	} catch {
		/* fine — the list is open again next time, which is the safe way to fail */
	}
}
