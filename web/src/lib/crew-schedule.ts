import { api, loadApi, type ApiResult } from '$lib/api';
import type { PlanAnswers, RsvpAnswer } from '$lib/room/rsvp';

/**
 * One of the crew's planned sessions (#2440) as you may see it: a plan in a
 * private channel that does not name you is not in the list.
 */
export interface CrewPlan extends PlanAnswers {
	id: string;
	workoutName: string;
	workoutJson: string;
	startsAt: string;
	createdBy: string;
	/** The voice channel it will run in; absent while it names none. */
	channelId?: string;
	channelName?: string;
	/** You planned it, so you may move or cancel it. */
	mine?: boolean;
}

/** The crew's calendar, soonest first. */
export function fetchCrewSchedule(
	crewId: string,
	fetcher: typeof fetch = fetch,
): Promise<ApiResult<{ sessions: CrewPlan[] }>> {
	return loadApi(fetcher, `/api/crews/${crewId}/schedule`);
}

/** In, out, or `null` to take your answer back (docs/SPEC.md: no maybe). */
export function answerCrewPlan(
	crewId: string,
	planId: string,
	answer: RsvpAnswer | null,
): Promise<ApiResult<void>> {
	const path = `/api/crews/${crewId}/schedule/${planId}/rsvp`;
	return answer === null
		? api<void>(path, { method: 'DELETE' })
		: api<void>(path, { method: 'PUT', json: { going: answer === 'in' } });
}
