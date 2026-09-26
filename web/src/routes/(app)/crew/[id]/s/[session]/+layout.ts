import { redirect } from '@sveltejs/kit';
import { prepareChannelAv } from '$lib/channel/connection.svelte';
import { voiceChannelPath } from '$lib/channels';
import { loadSessionPage } from '$lib/session/session-page';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch, params }) => {
	const [data] = await Promise.all([
		loadSessionPage(params.id, params.session, fetch),
		prepareChannelAv(),
	]);
	// A session that has ended hands its address back to the channel it ran
	// in (#2600): a reload, a shared link or a notification opened late lands
	// where the call still is, and rejoins it.
	if (data.endedIn) redirect(307, voiceChannelPath(params.id, data.endedIn));
	return data;
};
