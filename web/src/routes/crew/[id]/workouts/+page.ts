import { fetchCrewChannels } from '$lib/channels';
import { fetchCrew, fetchCrewRecaps } from '$lib/crew';
import { fetchCrewSchedule } from '$lib/crew-workouts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const [crew, schedule, recaps, channels] = await Promise.all([
		fetchCrew(params.id, fetch),
		fetchCrewSchedule(params.id, fetch),
		fetchCrewRecaps(params.id, fetch),
		fetchCrewChannels(params.id, fetch),
	]);
	// The page is the schedule and the recaps; either failing is the page
	// failing, and says so with a retry rather than an empty list that lies.
	const failed = !crew.ok
		? crew
		: !schedule.ok
			? schedule
			: !recaps.ok
				? recaps
				: null;
	return {
		id: params.id,
		crew: crew.ok ? crew.data : null,
		plans: schedule.ok ? schedule.data.sessions : [],
		recaps: recaps.ok ? recaps.data.recaps : [],
		// Where a plan can run. Without them the plan form says why it cannot.
		voice: channels.ok
			? channels.data.channels.filter((c) => c.kind === 'voice')
			: [],
		error: failed && !failed.ok ? failed.error.message : null,
		// not_found is "not yours to see" and permanent (#1677).
		errorCode: failed && !failed.ok ? failed.error.error : null,
	};
};
