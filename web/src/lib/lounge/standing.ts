/**
 * A rider's standing in the cozy room (docs/spec/lounge.md "Your numbers"):
 * the level on their name, and the moment it or their rider streak grows.
 * The roster carries both, refreshed by the server when a ride of theirs is
 * saved; each screen compares with what it last saw, so a celebration needs
 * nothing on the wire of its own.
 */
import { levelFromXp } from '$lib/level';

/** How long a celebration lasts: the figure dances and the banner hangs over them. */
export const CHEER_SEC = 5;

/** What a rider celebrates: the level they reached, the weeks in a row, or both. */
export interface Cheer {
	id: string;
	level?: number;
	streak?: number;
}

/** A rider as the roster carries their standing. */
export interface Standing {
	id: string;
	totalXp?: number;
	streakWeeks?: number;
}

/** What a room last saw of each rider. */
export type SeenStanding = Map<string, { level: number; streak: number }>;

/**
 * What grew since this room last saw each rider: a level gained, or the
 * rider streak. A rider seen for the first time is remembered and never
 * celebrated, so opening the room on a crew is quiet, and a streak that
 * lapsed is only remembered. `seen` is the room's memory, updated in place.
 */
export function cheersOf(
	seen: SeenStanding,
	riders: readonly Standing[],
): Cheer[] {
	const cheers: Cheer[] = [];
	for (const rider of riders) {
		// A server older than the badge sends no XP: nothing to compare.
		if (rider.totalXp === undefined) continue;
		const now = {
			level: levelFromXp(rider.totalXp),
			streak: rider.streakWeeks ?? 0,
		};
		const was = seen.get(rider.id);
		seen.set(rider.id, now);
		if (!was) continue;
		const cheer: Cheer = { id: rider.id };
		if (now.level > was.level) cheer.level = now.level;
		if (now.streak > was.streak) cheer.streak = now.streak;
		if (cheer.level !== undefined || cheer.streak !== undefined)
			cheers.push(cheer);
	}
	return cheers;
}

/** The banner over the rider: "Level 12", "3 weeks in a row", or both. */
export function cheerWords(cheer: Cheer): string {
	const words: string[] = [];
	if (cheer.level !== undefined) words.push(`Level ${cheer.level}`);
	if (cheer.streak !== undefined)
		words.push(
			cheer.streak === 1 ? 'A streak begins' : `${cheer.streak} weeks in a row`,
		);
	return words.join(' · ');
}
