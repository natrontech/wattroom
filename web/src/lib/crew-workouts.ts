import type { SessionRecap } from '$lib/protocol';

/**
 * A crew's workouts (#2455, ADR-0058): what it has planned and what it has
 * ridden together, derived from its schedule and its recaps — no shelf of
 * its own. A crew shelf of saved workouts is a follow-up if anyone asks.
 */

// The schedule reads and the plan it writes are $lib/crew-schedule's (#2452):
// one module for the crew's calendar, whichever page is planning.

/**
 * A workout the crew rode together (#2583): how often, for how long, by whom
 * and when it last did — presence and time only, which is all a recap holds
 * (ADR-0034). The riders are names the recap card already shows.
 */
export interface RiddenWorkout {
	name: string;
	times: number;
	/** Unix millis — when the last session of it ended. */
	lastAt: number;
	/** Its sessions' shared timelines, summed. */
	seconds: number;
	/** Everyone else who rode it, the most sessions first — you are `yours`. */
	riders: string[];
	/** How many of its sessions the viewer rode. */
	yours: number;
	/** Its sessions, newest first. */
	recaps: SessionRecap[];
}

/** The crew's recaps folded by workout, the most recently ridden first. */
export function riddenTogether(
	recaps: SessionRecap[],
	me?: string,
): RiddenWorkout[] {
	const byName = new Map<
		string,
		RiddenWorkout & { counts: Map<string, { name: string; n: number }> }
	>();
	for (const recap of recaps) {
		const name = recap.workout.trim();
		if (!name) continue;
		let seen = byName.get(name);
		if (!seen) {
			seen = {
				name,
				times: 0,
				lastAt: 0,
				seconds: 0,
				riders: [],
				yours: 0,
				recaps: [],
				counts: new Map(),
			};
			byName.set(name, seen);
		}
		seen.times += 1;
		seen.lastAt = Math.max(seen.lastAt, recap.endedAt);
		seen.seconds += Math.max(0, (recap.endedAt - recap.startedAt) / 1000);
		seen.recaps.push(recap);
		// A rider counts once per session, however often they dropped in.
		const rode = new Map(
			recap.riders.filter((r) => r.rode).map((r) => [r.id, r.rider]),
		);
		for (const [id, rider] of rode) {
			if (id === me) continue;
			const count = seen.counts.get(id) ?? { name: rider, n: 0 };
			count.n += 1;
			seen.counts.set(id, count);
		}
		if (me && rode.has(me)) seen.yours += 1;
	}
	return [...byName.values()]
		.map(({ counts, ...workout }) => ({
			...workout,
			riders: [...counts.values()]
				.sort((a, b) => b.n - a.n)
				.map((count) => count.name),
			recaps: workout.recaps.sort((a, b) => b.endedAt - a.endedAt),
		}))
		.sort((a, b) => b.lastAt - a.lastAt);
}

/** The page's tiles: the whole crew's sums, and your own turnout (ADR-0036). */
export function riddenTotals(ridden: RiddenWorkout[]) {
	return {
		sessions: ridden.reduce((n, w) => n + w.times, 0),
		workouts: ridden.length,
		seconds: ridden.reduce((n, w) => n + w.seconds, 0),
		yours: ridden.reduce((n, w) => n + w.yours, 0),
	};
}

/**
 * The definition behind a name, from the first source that holds it — a
 * recap keeps only the name, so riding it again needs the workout from
 * somewhere else: a plan still on the schedule, or the rider's own shelf.
 * Null when none does: whoever coached it built it, and it is theirs.
 */
export function workoutByName(
	name: string,
	sources: readonly { name: string; json: string }[],
): string | null {
	return sources.find((source) => source.name === name)?.json ?? null;
}
