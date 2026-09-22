import type { ApiResult } from '$lib/api';
import type { CrewChannel } from '$lib/channels';
import type { Crew, CrewMembers } from '$lib/crew';
import type { Announcement } from '$lib/room/room-data';

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
