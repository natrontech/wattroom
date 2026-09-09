import { fetchCrew } from '$lib/crew';
import type { CrewPageData } from '../+page';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await fetchCrew(params.id, fetch);
	return {
		id: params.id,
		crew: res.ok ? res.data : null,
		error: res.ok ? null : res.error.message,
		errorCode: res.ok ? null : res.error.error,
	} satisfies CrewPageData;
};
