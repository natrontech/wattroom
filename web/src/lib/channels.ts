import { api, loadApi, type ApiResult } from '$lib/api';
import type { ChannelPresence } from '$lib/protocol';

export type ChannelKind = 'text' | 'voice';
export type AutoplayOrder = 'ordered' | 'shuffled' | 'smart';

export interface ChannelMember {
	id: string;
	displayName: string;
	avatarUrl?: string;
}

export interface ChannelAutoplay {
	enabled: boolean;
	order: AutoplayOrder;
	/** One of the crew's playlists; absent when none is chosen. */
	playlistId?: string;
}

/**
 * A crew's channel (ADR-0058): a text channel is a name, a gate and a
 * scrollback; a voice channel is a name, a gate, a deck and who is in it.
 * The list holds only the channels you may enter — a private one that does
 * not name you is not in it at all. The crew's owner and admins keep them
 * (#2434); a private one admits them and the members named into it.
 */
export interface CrewChannel {
	id: string;
	kind: ChannelKind;
	name: string;
	position: number;
	private: boolean;
	/** A voice channel's; a text channel makes no sound. */
	soundPack?: 'base' | 'silent';
	autoplay?: ChannelAutoplay;
	/** A private channel's named members; owner and admins enter by role. */
	members?: ChannelMember[];
	/** A voice channel's: who is in it right now (#2436). */
	presence?: ChannelPresence;
}

/** Absent fields keep their value; `playlistId: ''` chooses none. */
export interface ChannelPatch {
	name?: string;
	position?: number;
	private?: boolean;
	soundPack?: 'base' | 'silent';
	autoplay?: Partial<ChannelAutoplay>;
}

export function fetchCrewChannels(
	crewId: string,
	fetcher: typeof fetch = fetch,
): Promise<ApiResult<{ channels: CrewChannel[] }>> {
	return loadApi(fetcher, `/api/crews/${crewId}/channels`);
}

/** Where a text channel is read. */
export const textChannelPath = (crewId: string, channelId: string) =>
	`/crew/${crewId}/c/${channelId}`;

/** The create action's words, short: a rider's text channel is a chat (#2696). */
export const newLabel = (kind: ChannelKind) =>
	kind === 'text' ? 'New chat' : 'New voice';

/** The delete action's words: a rider's text channel is a chat channel (#2696). */
export const deleteLabel = (kind: ChannelKind) =>
	kind === 'text' ? 'Delete the chat' : 'Delete the channel';

/** Where a voice channel is (#2449). */
export const voiceChannelPath = (crewId: string, channelId: string) =>
	`/crew/${crewId}/v/${channelId}`;

export function createChannel(
	crewId: string,
	channel: { kind: ChannelKind; name: string; private?: boolean },
): Promise<ApiResult<CrewChannel>> {
	return api<CrewChannel>(`/api/crews/${crewId}/channels`, {
		method: 'POST',
		json: channel,
	});
}

export function updateChannel(
	id: string,
	patch: ChannelPatch,
): Promise<ApiResult<CrewChannel>> {
	return api<CrewChannel>(`/api/channels/${id}`, {
		method: 'PATCH',
		json: patch,
	});
}

/** Takes everything in it — chat, play log, recaps. Ask first (errors.md). */
/** What deleting a channel takes, for the confirm that asks first (errors.md).
 *  A private voice channel's plans go with it (#2610); an open one's stay on
 *  the crew's schedule. */
export function deleteChannelWarning(c: {
	kind: ChannelKind;
	private?: boolean;
}): string {
	if (c.kind === 'text')
		return 'Every message and image in it goes with it, for everyone in the crew. There is no undo.';
	const plans = c.private
		? 'Any session planned in it is cancelled, and whoever could ride it is told.'
		: 'Any session planned in it stays on the crew’s schedule, with no voice channel.';
	return `Its play log and the recaps of the sessions ridden in it go with it, for everyone in the crew. ${plans} There is no undo.`;
}

export function deleteChannel(id: string): Promise<ApiResult<void>> {
	return api<void>(`/api/channels/${id}`, { method: 'DELETE' });
}

/** Name a crew member into a private channel, or take them out of it. */
export function setNamedInChannel(
	id: string,
	userId: string,
	named: boolean,
): Promise<ApiResult<void>> {
	return api<void>(`/api/channels/${id}/members/${userId}`, {
		method: named ? 'PUT' : 'DELETE',
	});
}

/** One line a coach marked, as every surface that draws it reads it. */
export interface Announcement {
	/** The marked message, so the strip can point back at the line. */
	messageId: string;
	text: string;
	/** The message's author, not whoever marked it. */
	from: string;
	/** The author's id, for their status beside the name (ADR-0060). */
	fromId?: string;
	/** ISO — the message's own timestamp, not the marking's. */
	at: string;
}

/** A text channel's marked line, as the crew's Board leads with it. */
export interface CrewAnnouncement extends Announcement {
	channelId: string;
	channelName: string;
}

/**
 * The newest announcement across the crew's text channels the caller may
 * enter (ADR-0058) — undefined when none is up, the Board's normal state.
 */
export function fetchCrewAnnouncement(
	crewId: string,
	fetcher: typeof fetch = fetch,
): Promise<ApiResult<CrewAnnouncement | undefined>> {
	return loadApi(fetcher, `/api/crews/${crewId}/announcement`);
}
