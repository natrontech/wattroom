import { prepareChannelAv } from '$lib/channel/connection.svelte';
import { loadSessionPage } from '$lib/session/session-page';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch, params }) => {
	const [data] = await Promise.all([
		loadSessionPage(params.id, params.session, fetch),
		prepareChannelAv(),
	]);
	return data;
};
