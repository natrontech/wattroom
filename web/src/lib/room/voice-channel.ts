import { loadApi, type ApiResult } from '$lib/api';
import { fetchCrewChannels, type CrewChannel } from '$lib/channels';
import {
	fetchCrew,
	fetchCrewMembers,
	type Crew,
	type CrewMembers,
} from '$lib/crew';
import type { LiveSession } from '$lib/protocol';
import type { Announcement } from '$lib/channels';

/**
 * What a voice channel's page needs (#2449): the channel, its crew, the
 * crew's numbers for the idle dashboard, and the crew's newest announcement
 * for the idle-only strip (ADR-0057 as re-keyed by ADR-0058). The channel
 * and the crew are the page; the other two are sections that go quiet on a
 * failure rather than taking the page with them.
 */
export interface VoiceChannelData {
	crew: Crew | null;
	channel: CrewChannel | null;
	members: CrewMembers | null;
	announcement: Announcement | null;
	error: string | null;
	/** not_found is "not yours to enter", and permanent (#1677). */
	errorCode: string | null;
}

const NOT_HERE =
	'No voice channel lives here — or it is one you may not enter.';

export function voiceChannelData(
	channelId: string,
	crew: ApiResult<Crew>,
	channels: ApiResult<{ channels: CrewChannel[] }>,
	members: ApiResult<CrewMembers>,
	announcement: ApiResult<Announcement | undefined>,
): VoiceChannelData {
	const failed = !crew.ok ? crew : !channels.ok ? channels : null;
	if (failed && !failed.ok)
		return {
			crew: null,
			channel: null,
			members: null,
			announcement: null,
			error: failed.error.message,
			errorCode: failed.error.error,
		};
	// The list holds only what the caller may enter, so a private channel
	// that does not name them is simply absent — the same 404 as none at all.
	const channel =
		channels.ok &&
		channels.data.channels.find(
			(c) => c.id === channelId && c.kind === 'voice',
		);
	return {
		crew: crew.ok ? crew.data : null,
		channel: channel || null,
		members: members.ok ? members.data : null,
		announcement: announcement.ok ? (announcement.data ?? null) : null,
		error: channel ? null : NOT_HERE,
		errorCode: channel ? null : 'not_found',
	};
}

/**
 * A crew role in the live shell's words — channels.LiveRole's mapping, so
 * the page agrees with the roster the hub sends: the crew's own words, since
 * coach is the session's and not a role (#2438).
 */
export function liveRoleOf(crewRole: string): string {
	return crewRole === 'owner' || crewRole === 'admin' ? crewRole : 'member';
}

/** Every read a voice channel's page makes, in one go (#2449, #2450). */
export async function loadVoiceChannel(
	crewId: string,
	channelId: string,
	fetcher: typeof fetch = fetch,
): Promise<VoiceChannelData> {
	const [crew, channels, members, announcement] = await Promise.all([
		fetchCrew(crewId, fetcher),
		fetchCrewChannels(crewId, fetcher),
		fetchCrewMembers(crewId, fetcher),
		loadApi<Announcement | undefined>(
			fetcher,
			`/api/crews/${crewId}/announcement`,
		),
	]);
	return voiceChannelData(channelId, crew, channels, members, announcement);
}

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
