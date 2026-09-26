import { fetchCrewChannels } from '$lib/channels';
import { fetchCrew } from '$lib/crew';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const [crew, channels] = await Promise.all([
		fetchCrew(params.id, fetch),
		fetchCrewChannels(params.id, fetch),
	]);
	const failed = !crew.ok ? crew : !channels.ok ? channels : null;
	// A channel the list does not hold is one you may not enter, or one that
	// is gone — the same answer, like the server's 404 (ADR-0058).
	const channel = channels.ok
		? (channels.data.channels.find(
				(c) => c.id === params.channel && c.kind === 'text',
			) ?? null)
		: null;
	return {
		crewId: params.id,
		crew: crew.ok ? crew.data : null,
		channel,
		error: failed && !failed.ok ? failed.error.message : null,
		// not_found is "not yours to see" and permanent (#1677).
		errorCode: failed && !failed.ok ? failed.error.error : null,
	};
};
