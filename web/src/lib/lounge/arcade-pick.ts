/** The game this device last picked on the cabinet, so it opens on it again. */
import type { GameId } from '$lib/lounge/games/game';

const KEY = 'wattroom.arcade.v1';
/** A tab on the cabinet: one of its games on one button, or Töggeli. */
export type Tab = GameId | 'toeggeli';

const IDS: readonly Tab[] = ['bergpreis', 'feedzone', 'darts', 'toeggeli'];

export function loadPref(): Tab {
	try {
		const id = localStorage.getItem(KEY) as Tab | null;
		return id && IDS.includes(id) ? id : 'bergpreis';
	} catch {
		return 'bergpreis';
	}
}

export function savePref(id: Tab): void {
	try {
		localStorage.setItem(KEY, id);
	} catch {
		// Private mode: the cabinet opens on Bergpreis next time.
	}
}
