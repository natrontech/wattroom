import { api, type ApiResult } from '$lib/api';
import { confirm } from '$lib/confirm.svelte';

/**
 * A crew listed in the directory asks first (#4149, ADR-0063): the server
 * held the owner's route back from it, and `ask` is its words for them —
 * "Anyone who joins ⟨crew⟩ will see this route." Asks, and records a yes so
 * the caller can try again; null when the owner keeps the route.
 */
export async function askToShareRoute(
	routeId: string,
	crewId: string,
	ask: string,
): Promise<ApiResult<void> | null> {
	const yes = await confirm({
		title: 'Share this route with the crew?',
		body: ask,
		action: 'Share it',
	});
	if (!yes) return null;
	return api<void>(
		`/api/routes/${encodeURIComponent(routeId)}/crews/${encodeURIComponent(crewId)}`,
		{ method: 'PUT', json: { shared: true } },
	);
}
