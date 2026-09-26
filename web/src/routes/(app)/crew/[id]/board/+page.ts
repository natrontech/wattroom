import { fetchCrewAnnouncement } from '$lib/channels';
import { fetchCrew } from '$lib/crew';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const [crew, announcement] = await Promise.all([
		fetchCrew(params.id, fetch),
		fetchCrewAnnouncement(params.id, fetch),
	]);
	return {
		id: params.id,
		crew: crew.ok ? crew.data : null,
		// A notice that cannot be read is not worth failing the Board over:
		// the pins are the page, and the page re-reads it on the next ping.
		announcement: announcement.ok ? (announcement.data ?? null) : null,
		error: crew.ok ? null : crew.error.message,
		// not_found is "not yours to see" and permanent (#1677).
		errorCode: crew.ok ? null : crew.error.error,
	};
};
