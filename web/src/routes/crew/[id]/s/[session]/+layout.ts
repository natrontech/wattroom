import { prepareRoomAv } from '$lib/room/connection.svelte';
import { loadSessionPage } from '$lib/room/voice-channel';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch, params }) => {
	const [data] = await Promise.all([
		loadSessionPage(params.id, params.session, fetch),
		prepareRoomAv(),
	]);
	return data;
};
