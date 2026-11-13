import { goto } from '$app/navigation';
import type { ApiResult } from '#lib/api.ts';
import { joinSessionPath } from '#lib/channel/address.ts';
import type { ChannelContext } from '#lib/channel/context.ts';
import { startCrewPlan } from '#lib/crew-schedule.ts';
import type { ControlRoute } from '#lib/protocol.ts';
import {
	startCrewSession,
	startRideTogether,
} from '#lib/session/crew-session.ts';
import { toasts } from '#lib/toast.svelte.ts';
import type { Workout } from '#lib/workout/types.ts';

type Shared = ChannelContext['shared'];

/** When this screen last cancelled a session: its own toast has the Undo. */
let cancelledHere = 0;
const OWN_CANCEL_MS = 5000;

/** This screen just cancelled the session, so it says so itself (#4562). */
export const cancelledOnThisScreen = (now = Date.now()): boolean =>
	now - cancelledHere < OWN_CANCEL_MS;

/**
 * How a cancelled session opens again (#4562): its plan started again,
 * which the cancel gave back; a Ride together; or the same pick on the same
 * road. Undefined for what cannot be rebuilt, a game's above all.
 */
export function reopener(
	crew: string,
	shared: Shared,
): (() => Promise<ApiResult<{ id: string }>>) | undefined {
	if (!shared) return undefined;
	const { planId, together, workoutJson, route } = shared;
	if (planId)
		return () =>
			startCrewPlan(crew, planId).then((res) =>
				res.ok ? { ...res, data: { id: res.data.sessionId ?? '' } } : res,
			);
	if (together) return () => startRideTogether(crew);
	if (!workoutJson) return undefined;
	let workout: Workout;
	try {
		workout = JSON.parse(workoutJson) as Workout;
	} catch {
		return undefined;
	}
	const road: ControlRoute | undefined = route
		? {
				id: route.id,
				fromM: route.fromM,
				reverse: route.reverse,
				loop: route.loop,
			}
		: undefined;
	return () => startCrewSession(crew, workout, road);
}

/**
 * The coach's Cancel session (#4562): at once, nothing ridden yet, and an
 * Undo that opens the same session again with them coaching. Everyone else
 * hears the cancel from the session sounds.
 */
export function cancelSession(
	channel: Pick<ChannelContext, 'shared' | 'address' | 'control'>,
): void {
	const crew = channel.address.crew;
	const again = reopener(crew, channel.shared);
	cancelledHere = Date.now();
	channel.control('end');
	toasts.push('Session cancelled.', {
		undo: again
			? () =>
					void again().then((res) => {
						if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
						else if (res.data.id) void goto(joinSessionPath(crew, res.data.id));
					})
			: undefined,
	});
}
