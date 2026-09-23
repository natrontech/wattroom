import { api, loadApi, type ApiResult } from '$lib/api';
import type { RoomPresence } from '$lib/protocol';

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
	presence?: RoomPresence;
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
