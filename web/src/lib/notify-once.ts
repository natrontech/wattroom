/**
 * Cross-tab announcement dedup (#219): every open tab runs its own cue
 * AudioContext and its own polls, so one message blipped once per tab.
 * localStorage is shared per origin — first tab to claim a (tag, at) wins.
 */
export function shouldAnnounce(tag: string, at: number): boolean {
	try {
		const key = `wattroom.announced.${tag}`;
		if (Number(localStorage.getItem(key) ?? 0) >= at) return false;
		localStorage.setItem(key, String(at));
		return true;
	} catch {
		return true; // no storage, no dedup — better twice than never
	}
}
