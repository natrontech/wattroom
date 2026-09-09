import { loadApi } from '$lib/api';
import { prepareRoomAv } from '$lib/room/connection.svelte';
import type { Room, RoomLoadData } from '$lib/room/room-data';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch, params }) => {
	// The AV chunk arrives with the room (#1514), beside the room's own read
	// rather than after it; the shell's join() needs it loaded.
	const [result] = await Promise.all([
		loadApi<Room>(fetch, `/api/rooms/${params.slug}`),
		prepareRoomAv(),
	]);
	return {
		room: result.ok ? result.data : null,
		roomError: result.ok ? null : result.error.message,
	} satisfies RoomLoadData;
};
