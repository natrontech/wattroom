import { followRoomLink } from '$lib/moved';
import type { PageLoad } from './$types';

// Rooms became a crew's channels (ADR-0058). Every old room link — the room,
// its chat, its ride, its sessions, members, board — lands on what took its
// place (#2458).
export const load: PageLoad = ({ fetch, params, url }) =>
	followRoomLink(fetch, params.slug, params.place, url);
