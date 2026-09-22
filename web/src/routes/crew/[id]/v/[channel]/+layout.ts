import { loadApi } from '$lib/api';
import { fetchCrewChannels } from '$lib/channels';
import { fetchCrew, fetchCrewMembers } from '$lib/crew';
import { prepareRoomAv } from '$lib/room/connection.svelte';
import type { Announcement } from '$lib/room/room-data';
import type { LayoutLoad } from './$types';
import { voiceChannelData } from '$lib/room/voice-channel';

export const load: LayoutLoad = async ({ fetch, params }) => {
	// The AV chunk arrives with the page (#1514), as the room's does; the
	// shell's join() needs it loaded.
	const [crew, channels, members, announcement] = await Promise.all([
		fetchCrew(params.id, fetch),
		fetchCrewChannels(params.id, fetch),
		fetchCrewMembers(params.id, fetch),
		loadApi<Announcement | undefined>(
			fetch,
			`/api/crews/${params.id}/announcement`,
		),
		prepareRoomAv(),
	]);
	return voiceChannelData(
		params.channel,
		crew,
		channels,
		members,
		announcement,
	);
};
