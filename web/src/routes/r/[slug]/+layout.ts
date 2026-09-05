import { loadApi } from '$lib/api';
import type { Room, RoomLoadData } from '$lib/room/room-data';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch, params }) => {
	const result = await loadApi<Room>(fetch, `/api/rooms/${params.slug}`);
	return {
		room: result.ok ? result.data : null,
		roomError: result.ok ? null : result.error.message,
	} satisfies RoomLoadData;
};
