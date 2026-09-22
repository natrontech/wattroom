import { loadApi, type ApiResult } from '$lib/api';

/**
 * A crew's channel (ADR-0058): a text channel is a name, a gate and a
 * scrollback; a voice channel is a name, a gate, a deck and who is in it.
 * The list holds only the channels you may enter — a private one that does
 * not name you is not in it at all.
 */
export interface CrewChannel {
	id: string;
	kind: 'text' | 'voice';
	name: string;
	position: number;
	private: boolean;
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
