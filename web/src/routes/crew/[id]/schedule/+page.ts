import { fetchCrewChannels } from '$lib/channels';
import { fetchCrew } from '$lib/crew';
import { fetchCrewSchedule } from '$lib/crew-schedule';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const [crew, schedule, channels] = await Promise.all([
		fetchCrew(params.id, fetch),
		fetchCrewSchedule(params.id, fetch),
		fetchCrewChannels(params.id, fetch),
	]);
	// The crew and its plans are the page; the channel list only fills the
	// pick, and a plan can name none (#2440), so it may fail on its own.
	const failed = !crew.ok ? crew : !schedule.ok ? schedule : null;
	return {
		id: params.id,
		crew: crew.ok ? crew.data : null,
		plans: schedule.ok ? schedule.data.sessions : null,
		voice: channels.ok
			? channels.data.channels.filter((c) => c.kind === 'voice')
			: [],
		error: failed && !failed.ok ? failed.error.message : null,
		// not_found is "not yours to see" and permanent (#1677).
		errorCode: failed && !failed.ok ? failed.error.error : null,
	};
};
