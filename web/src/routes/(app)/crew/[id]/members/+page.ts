import { fetchCrew, fetchCrewMembers, fetchCrewRecaps } from '$lib/crew';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const [crew, members, recaps] = await Promise.all([
		fetchCrew(params.id, fetch),
		fetchCrewMembers(params.id, fetch),
		fetchCrewRecaps(params.id, fetch),
	]);
	// The page needs the first two; the recaps are a section that can fail on
	// its own without the roster going with it.
	const failed = !crew.ok ? crew : !members.ok ? members : null;
	return {
		id: params.id,
		crew: crew.ok ? crew.data : null,
		members: members.ok ? members.data : null,
		recaps: recaps.ok ? recaps.data.recaps : null,
		error: failed && !failed.ok ? failed.error.message : null,
		// not_found is "not yours to see" and permanent (#1677).
		errorCode: failed && !failed.ok ? failed.error.error : null,
	};
};
