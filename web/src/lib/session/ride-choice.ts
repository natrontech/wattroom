import type { ShelfEntry } from '#lib/workout/shelf.ts';

/** With whom (#4616): alone, joining the session here, or starting one. */
export type RideWho = 'alone' | 'join' | 'start';
/** What: the session's own, one bunch on a road, a workout, or free. */
export type RideWhat = 'session' | 'bunch' | 'mine' | 'free';

/** How many workouts the ride sheet offers before the full picker. */
export const PICKABLE = 6;

/**
 * The workouts the ride sheet offers, in order: today's plan, then the
 * rider's own, then what they rode lately, then the rest of the shelf. The
 * one a door already chose is always among them, whatever its place.
 */
export function pickable(
	shelf: ShelfEntry[],
	plannedToday: string[],
	chosen: string | null,
): ShelfEntry[] {
	const rank = (e: ShelfEntry) =>
		plannedToday.includes(e.id) ? 0 : e.yours ? 1 : e.recent ? 2 : 3;
	const ordered = shelf
		.map((e, i) => ({ e, i }))
		.sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
		.map(({ e }) => e);
	const top = ordered.slice(0, PICKABLE);
	const door = chosen ? ordered.find((e) => e.id === chosen) : undefined;
	if (door && !top.includes(door)) top[top.length - 1] = door;
	return top;
}
