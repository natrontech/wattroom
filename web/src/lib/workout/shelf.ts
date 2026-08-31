import type { CustomWorkout } from './custom.svelte';
import { library } from './library';
import type { Workout } from './types';

/**
 * The shelf a session is picked from: what the rider wrote, then the curated
 * library. One shape, because every surface that plans a session renders the
 * same picker — the room's and /sessions' (#359).
 */
export interface ShelfEntry {
	id: string;
	yours: boolean;
	focus?: string;
	/** One line on what it is for; the library's, absent on your own. */
	summary?: string;
	workout: Workout;
}

export function buildShelf(custom: CustomWorkout[]): ShelfEntry[] {
	return [
		...custom.map((entry) => ({ ...entry, yours: true })),
		...library.map((entry) => ({ ...entry, yours: false })),
	];
}
