import { loadApi } from '$lib/api';
import type { Room } from '$lib/room/room-data';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const result = await loadApi<Room>(fetch, `/api/rooms/${params.slug}`);
	return {
		room: result.ok ? result.data : null,
		roomError: result.ok ? null : result.error.message,
	};
};

export type RoomPageData = { room: Room | null; roomError: string | null };
