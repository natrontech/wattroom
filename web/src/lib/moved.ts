import { redirect } from '@sveltejs/kit';
import { loadApi } from '$lib/api';
import type { LiveSession } from '$lib/protocol';
import { toasts } from '$lib/toast.svelte';

/** What an old room became (#2446): its crew, and the channels it split into. */
export interface MovedRoom {
	crewId: string;
	textChannelId?: string;
	voiceChannelId?: string;
}

/**
 * Where an old room path lands now (#2458). `place` is what followed
 * `/r/[slug]/`; `session` is the one running in the room's voice channel.
 * A place the room had and the crew does not falls back to the text channel,
 * which is where a room's link used to open.
 */
export function movedTo(
	moved: MovedRoom,
	place: string,
	session?: string,
): string {
	const crew = `/crew/${moved.crewId}`;
	const voice = moved.voiceChannelId
		? `${crew}/v/${moved.voiceChannelId}`
		: crew;
	switch (place) {
		case 'training':
		case 'watch':
			return session ? `${crew}/s/${session}` : voice;
		case 'sessions':
			return `${crew}/schedule`;
		case 'members':
		case 'settings':
		case 'board':
			return `${crew}/${place}`;
		case 'pins':
			return `${crew}/board`;
		default:
			return moved.textChannelId ? `${crew}/c/${moved.textChannelId}` : crew;
	}
}

/**
 * Follows an old room link from a route's load: asks the server once where
 * the room went, and redirects there. Signed out, it goes through sign-in and
 * comes back to the same old link; a room that never became a channel lands
 * on Home and says so rather than on a 404.
 */
export async function followRoomLink(
	fetcher: typeof fetch,
	slug: string,
	place: string,
	from: URL,
): Promise<never> {
	const res = await loadApi<MovedRoom>(
		fetcher,
		`/api/moved/r/${encodeURIComponent(slug)}`,
	);
	if (!res.ok) {
		if (res.error.error === 'unauthorized')
			redirect(
				307,
				`/login?next=${encodeURIComponent(from.pathname + from.search)}`,
			);
		toasts.push(res.error.message, { tone: 'error' });
		redirect(307, '/home');
	}
	let session: string | undefined;
	if ((place === 'training' || place === 'watch') && res.data.voiceChannelId) {
		const live = await loadApi<{ sessions: LiveSession[] }>(
			fetcher,
			`/api/crews/${res.data.crewId}/live`,
		);
		// Soft: the voice channel is a fine landing when the live list is not.
		if (live.ok)
			session = live.data.sessions.find(
				(s) => s.channel === res.data.voiceChannelId,
			)?.id;
	}
	redirect(307, movedTo(res.data, place, session));
}
