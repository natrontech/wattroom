import { api, type ApiResult } from '$lib/api';
import type { ControlRoute } from '$lib/protocol';
import { flatten } from '$lib/workout/engine';
import type { Workout } from '$lib/workout/types';

/**
 * Starts a session of the crew's own (docs/SESSIONS.md): the picked workout,
 * on a road if one came with it, opened on the server with the caller
 * coaching. The answer is its id, which is its address.
 */
export function startCrewSession(
	crew: string,
	picked: Workout,
	route?: ControlRoute,
): Promise<ApiResult<{ id: string }>> {
	const total = flatten(picked).reduce(
		(t, s) => Math.max(t, s.startSeconds + s.seconds),
		0,
	);
	return api<{ id: string }>(`/api/crews/${crew}/sessions`, {
		method: 'POST',
		json: {
			workoutName: picked.name,
			workoutJson: JSON.stringify(picked),
			totalSeconds: total,
			route,
		},
	});
}

/** Starts a session with no workout (docs/SESSIONS.md): everyone rides their own free ride. */
export function startRideTogether(
	crew: string,
): Promise<ApiResult<{ id: string }>> {
	return api<{ id: string }>(`/api/crews/${crew}/sessions`, {
		method: 'POST',
		json: { together: true },
	});
}
