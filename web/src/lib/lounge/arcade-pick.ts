/** The game this device last picked on the cabinet, so it opens on it again. */
import type { GameId } from '$lib/lounge/games/game';

const KEY = 'wattroom.arcade.v1';
const IDS: readonly GameId[] = ['bergpreis', 'feedzone', 'darts'];

export function loadPref(): GameId {
	try {
		const id = localStorage.getItem(KEY) as GameId | null;
		return id && IDS.includes(id) ? id : 'bergpreis';
	} catch {
		return 'bergpreis';
	}
}

export function savePref(id: GameId): void {
	try {
		localStorage.setItem(KEY, id);
	} catch {
		// Private mode: the cabinet opens on Bergpreis next time.
	}
}
