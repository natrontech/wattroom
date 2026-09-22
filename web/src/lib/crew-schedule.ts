import { api, loadApi, type ApiResult } from '$lib/api';
import type { RsvpAnswer } from '$lib/room/rsvp';
import type { CrewRole } from '$lib/crew';

/**
 * The crew's schedule (#2440, #2452): one calendar for the crew, a plan naming
 * the voice channel it will run in or none yet. The server's roles matrix:
 * any member plans and answers; the owner and admins move and cancel any
 * plan, a member their own; any member who may enter the channel starts one.
 */
export interface CrewPlan {
	id: string;
	workoutName: string;
	workoutJson: string;
	startsAt: string;
	createdBy: string;
	/** Who said they are in, first to say so first (#450). */
	going?: { id: string; displayName: string }[];
	/** A count, never names (#1011). */
	out?: number;
	unanswered?: number;
	yourAnswer?: RsvpAnswer;
	/** The voice channel it names; absent while it names none. */
	channelId?: string;
	channelName?: string;
	/** You planned it — a member moves and cancels their own. */
	mine?: boolean;
}

export function fetchCrewSchedule(
	crewId: string,
	fetcher: typeof fetch = fetch,
): Promise<ApiResult<{ sessions: CrewPlan[] }>> {
	return loadApi(fetcher, `/api/crews/${crewId}/schedule`);
}

export function planCrewSession(
	crewId: string,
	plan: {
		workoutName: string;
		workoutJson: string;
		startsAt: string;
		channelId?: string;
	},
): Promise<ApiResult<CrewPlan>> {
	return api(`/api/crews/${crewId}/schedule`, { method: 'POST', json: plan });
}

export function moveCrewPlan(
	crewId: string,
	planId: string,
	startsAt: string,
): Promise<ApiResult<void>> {
	return api(`/api/crews/${crewId}/schedule/${planId}`, {
		method: 'PATCH',
		json: { startsAt },
	});
}

export function cancelCrewPlan(
	crewId: string,
	planId: string,
): Promise<ApiResult<void>> {
	return api(`/api/crews/${crewId}/schedule/${planId}`, { method: 'DELETE' });
}

/** Your answer; null takes it back — the third state is no answer. */
export function answerCrewPlan(
	crewId: string,
	planId: string,
	answer: RsvpAnswer | null,
): Promise<ApiResult<void>> {
	const path = `/api/crews/${crewId}/schedule/${planId}/rsvp`;
	return answer === null
		? api(path, { method: 'DELETE' })
		: api(path, { method: 'PUT', json: { going: answer === 'in' } });
}

/** Opens the plan's session in its channel with you as coach (#2440). A plan
 *  that names no channel takes one here. */
export function startCrewPlan(
	crewId: string,
	planId: string,
	channelId?: string,
): Promise<ApiResult<{ channelId: string }>> {
	return api(`/api/crews/${crewId}/schedule/${planId}/started`, {
		method: 'POST',
		json: channelId ? { channelId } : {},
	});
}

/** The crew's calendar feed (#2441): no sign-in, the token is the key. */
export const crewCalendarLink = (
	origin: string,
	crewId: string,
	token: string,
) => `${origin}/api/crews/${crewId}/calendar/${token}.ics`;

export function rotateCrewCalendar(
	crewId: string,
): Promise<ApiResult<{ icsToken: string }>> {
	return api(`/api/crews/${crewId}/calendar/rotate`, { method: 'POST' });
}

/** Where a plan runs, as its row says it. */
export const planPlace = (plan: Pick<CrewPlan, 'channelName'>) =>
	plan.channelName ? `in ${plan.channelName}` : 'no voice channel yet';

/** The matrix's "move / cancel": the owner and admins any plan, a member
 *  their own. */
export const mayRearrange = (plan: Pick<CrewPlan, 'mine'>, role: CrewRole) =>
	role === 'owner' || role === 'admin' || !!plan.mine;
