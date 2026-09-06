/**
 * Sounds a change, never a state (#834).
 *
 * Every cue that follows a value rather than an event needs the same two
 * guards, and two effects in RoomShell had started to grow their own copy:
 * fire only when the value actually moved, and stay silent on the first
 * observation — a rider walking into a room that is already dropped has not
 * just had it drop, and the banner is there to say so.
 *
 * The first value must not be `undefined`: that is the sentinel for
 * "nothing seen yet".
 */
export function changes<T>(cue: (next: T, previous: T) => void) {
	let seen: T | undefined;
	return (next: T): void => {
		const previous = seen;
		seen = next;
		if (previous === undefined || previous === next) return;
		cue(next, previous);
	};
}
