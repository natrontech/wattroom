import { prepareChannelAv } from '$lib/channel/connection.svelte';
import { loadVoiceChannel } from '$lib/channel/voice-channel';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch, params }) => {
	// The AV chunk arrives with the page (#1514), as a session's does; the
	// shell's join() needs it loaded.
	const [data] = await Promise.all([
		loadVoiceChannel(params.id, params.channel, fetch),
		prepareChannelAv(),
	]);
	return data;
};
