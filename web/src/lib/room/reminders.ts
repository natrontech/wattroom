import type { RoomEvent } from '$lib/protocol';

const REMINDER_LEAD_MS = 10 * 60_000;

/**
 * The one timeline line no server sends (#359): the hub does not know the
 * schedule, so the reminder is derived from the same list the plan card
 * renders, off the tick's clock so it appears without a reload.
 */
export function remindersFor(
	upcoming: { id: string; workoutName: string; startsAt: string }[],
	now: number,
): RoomEvent[] {
	return upcoming
		.filter((entry) => {
			const gap = new Date(entry.startsAt).getTime() - now;
			return gap < REMINDER_LEAD_MS && gap > -30 * 60_000;
		})
		.map((entry) => {
			const at = new Date(entry.startsAt).getTime();
			return {
				id: `due:${entry.id}`,
				kind: 'session',
				verb: 'due',
				subject: entry.workoutName,
				when: at,
				count: 1,
				// Pinned where it comes due, not where it was computed: the
				// line must not walk down the log as the clock ticks.
				at: at - REMINDER_LEAD_MS,
			};
		});
}
