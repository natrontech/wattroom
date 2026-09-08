import { fetchCrew, type Crew } from '$lib/crew';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await fetchCrew(params.id, fetch);
	return {
		id: params.id,
		crew: res.ok ? res.data : null,
		error: res.ok ? null : res.error.message,
	} satisfies { id: string; crew: Crew | null; error: string | null };
};
