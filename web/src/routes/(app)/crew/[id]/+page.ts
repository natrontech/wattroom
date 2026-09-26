import { fetchCrew, type Crew } from '$lib/crew';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await fetchCrew(params.id, fetch);
	return {
		id: params.id,
		crew: res.ok ? res.data : null,
		error: res.ok ? null : res.error.message,
		// not_found is "not yours to see" and permanent; anything else is a
		// crew that could not be asked, and gets a retry (#1677).
		errorCode: res.ok ? null : res.error.error,
	};
};

export type CrewPageData = {
	id: string;
	crew: Crew | null;
	error: string | null;
	errorCode: string | null;
};
