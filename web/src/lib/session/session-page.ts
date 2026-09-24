import { loadApi } from '$lib/api';
import { fetchCrewRecaps } from '$lib/crew';
import type { LiveSession } from '$lib/protocol';
import {
	loadVoiceChannel,
	type VoiceChannelData,
} from '$lib/channel/voice-channel';

/**
 * A session's page (#2450): the session, and the voice channel it runs in,
 * read as that channel's page reads it. A session has no table (ADR-0058):
 * while it runs it is in the crew's live list; once it ends it is not, and
 * the page says where what it left is.
 */
export interface SessionPageData {
	session: LiveSession | null;
	voice: VoiceChannelData | null;
	/** The crew's live list could not be read at all. */
	error: string | null;
	/** An ended session's voice channel, found by its recap (#2600): its
	 *  address leads back there rather than to a page that says it ended. */
	endedIn?: string;
}

export async function loadSessionPage(
	crewId: string,
	sessionId: string,
	fetcher: typeof fetch = fetch,
): Promise<SessionPageData> {
	const live = await loadApi<{ sessions: LiveSession[] }>(
		fetcher,
		`/api/crews/${crewId}/live`,
	);
	if (!live.ok)
		return { session: null, voice: null, error: live.error.message };
	const session = live.data.sessions.find((s) => s.id === sessionId) ?? null;
	if (!session) {
		// Only the channels you may enter list their recaps, so a private
		// channel's ended session stays as unfound as it was.
		const recaps = await fetchCrewRecaps(crewId, fetcher);
		const endedIn = recaps.ok
			? recaps.data.recaps.find((r) => r.sessionId === sessionId)?.channelId
			: undefined;
		return { session: null, voice: null, error: null, endedIn };
	}
	return {
		session,
		voice: await loadVoiceChannel(crewId, session.channel, fetcher),
		error: null,
	};
}
