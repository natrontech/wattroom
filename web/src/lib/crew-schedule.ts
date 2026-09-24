import { api, loadApi, type ApiResult } from '$lib/api';
import { serverNow } from '$lib/server-clock';
import type { CrewRole } from '$lib/crew';
import type { PlanAnswers, RsvpAnswer } from '$lib/session/rsvp';

/**
 * The crew's schedule (#2440, #2452): one calendar for the crew, a plan naming
 * the voice channel it will run in or none yet. The server's roles matrix:
 * any member plans and answers; the owner and admins move and cancel any
 * plan, a member their own; any member who may enter the channel starts one.
 */

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

/** A tap on "I'm in" or "I'm out": your own answer again takes it back, the
 *  other one changes your mind. Neither asks — a second tap undoes it
 *  (errors.md). */
export const pressAnswer = (
	crewId: string,
	plan: Pick<CrewPlan, 'id' | 'yourAnswer'>,
	pressed: RsvpAnswer,
) =>
	answerCrewPlan(crewId, plan.id, plan.yourAnswer === pressed ? null : pressed);

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

/** Due enough to offer Start now: fifteen minutes out, on the server's clock
 *  (#1909) — the Schedule's row and the voice channel's card ask the same. */
export const planDue = (startsAt: string, now = serverNow()): boolean =>
	Date.parse(startsAt) - now < 15 * 60_000;

/** Where a plan runs, as its row says it. */
export const planPlace = (plan: Pick<CrewPlan, 'channelName'>) =>
	plan.channelName ? `in ${plan.channelName}` : 'no voice channel yet';

/** The matrix's "move / cancel": the owner and admins any plan, a member
 *  their own. */
export const mayRearrange = (plan: Pick<CrewPlan, 'mine'>, role: CrewRole) =>
	role === 'owner' || role === 'admin' || !!plan.mine;
