import { api, loadApi, type ApiResult } from '$lib/api';
import type { SessionRecap } from '$lib/protocol';

/**
 * A crew's workouts (#2455, ADR-0058): what it has planned and what it has
 * ridden together, derived from its schedule and its recaps — no shelf of
 * its own. A crew shelf of saved workouts is a follow-up if anyone asks.
 */

/** One plan on the crew's schedule, as GET /api/crews/{id}/schedule lists it. */
export interface CrewPlan {
	id: string;
	workoutName: string;
	workoutJson: string;
	startsAt: string;
	channelId?: string;
	channelName?: string;
}

export function fetchCrewSchedule(
	crewId: string,
	fetcher: typeof fetch = fetch,
): Promise<ApiResult<{ sessions: CrewPlan[] }>> {
	return loadApi(fetcher, `/api/crews/${crewId}/schedule`);
}

/** Put a workout on the crew's schedule, in one of its voice channels. */
export function planCrewSession(
	crewId: string,
	plan: {
		workoutName: string;
		workoutJson: string;
		startsAt: string;
		channelId: string;
	},
) {
	return api<CrewPlan>(`/api/crews/${crewId}/schedule`, {
		method: 'POST',
		json: plan,
	});
}

/** A workout the crew rode together: how often, and when it last did. */
export interface RiddenWorkout {
	name: string;
	times: number;
	/** Unix millis — when the last session of it ended. */
	lastAt: number;
}

/** The crew's recaps folded by workout, the most recently ridden first. */
export function riddenTogether(recaps: SessionRecap[]): RiddenWorkout[] {
	const byName = new Map<string, RiddenWorkout>();
	for (const recap of recaps) {
		const name = recap.workout.trim();
		if (!name) continue;
		const seen = byName.get(name);
		if (seen) {
			seen.times += 1;
			seen.lastAt = Math.max(seen.lastAt, recap.endedAt);
		} else byName.set(name, { name, times: 1, lastAt: recap.endedAt });
	}
	return [...byName.values()].sort((a, b) => b.lastAt - a.lastAt);
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
