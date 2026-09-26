import { fetchCrewChannels } from '$lib/channels';
import { fetchCrew, fetchCrewRecaps } from '$lib/crew';
import { fetchCrewSchedule } from '$lib/crew-schedule';
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
	// So are the channels a plan can name: read as none, they told a crew
	// that has three that it has no voice channel (#2628).
	const failed = !crew.ok
		? crew
		: !schedule.ok
			? schedule
			: !recaps.ok
				? recaps
				: !channels.ok
					? channels
					: null;
	return {
		id: params.id,
		crew: crew.ok ? crew.data : null,
		plans: schedule.ok ? schedule.data.sessions : [],
		recaps: recaps.ok ? recaps.data.recaps : [],
		// Where a plan can run — or none yet, as on the Schedule (#2440).
		voice: channels.ok
			? channels.data.channels.filter((c) => c.kind === 'voice')
			: [],
		error: failed && !failed.ok ? failed.error.message : null,
		// not_found is "not yours to see" and permanent (#1677).
		errorCode: failed && !failed.ok ? failed.error.error : null,
	};
};
