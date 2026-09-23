import { loadApi } from '$lib/api';
import type { LiveSession } from '$lib/protocol';
import {
	loadVoiceChannel,
	type VoiceChannelData,
} from '$lib/room/voice-channel';

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
	if (!session) return { session: null, voice: null, error: null };
	return {
		session,
		voice: await loadVoiceChannel(crewId, session.channel, fetcher),
		error: null,
	};
}
