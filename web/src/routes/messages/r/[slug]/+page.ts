import { followRoomLink } from '$lib/moved';
import type { PageLoad } from './$types';

// A room's thread is its text channel's now (ADR-0058, #2458).
export const load: PageLoad = ({ fetch, params, url }) =>
	followRoomLink(fetch, params.slug, 'chat', url);
