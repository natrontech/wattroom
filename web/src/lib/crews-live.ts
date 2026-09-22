import { loadApi, type ApiResult } from '$lib/api';
import type { ChannelKind } from '$lib/channels';
import type { CrewRole } from '$lib/crew';
import type { LiveSession } from '$lib/protocol';

/**
 * What is going on in every crew you are in, from one fetch (#2444): who is
 * in each voice channel and what runs there, what is unread in each text
 * channel, and the crew's next plan. Filtered all the way down by who may
 * enter what — a private channel that does not name you is absent, with its
 * people and its plan. Presence only (ADR-0010's radar): never a number.
 */
export interface LiveOccupant {
	id: string;
	name: string;
	voice?: boolean;
	camera?: boolean;
	riding?: boolean;
	away?: boolean;
}

export interface LiveChannel {
	id: string;
	kind: ChannelKind;
	name: string;
	private?: boolean;
	/** A voice channel's, in the hub's order. */
	occupants?: LiveOccupant[];
	/** A voice channel's running session (#2438), if one is. */
	session?: LiveSession;
	/** A text channel's lines from others since you last read it. */
	unread?: number;
}

export interface LivePlan {
	id: string;
	workoutName: string;
	startsAt: string;
	channelId?: string;
	channelName?: string;
}

export interface LiveCrew {
	id: string;
	name: string;
	icon?: string;
	role: CrewRole;
	channels: LiveChannel[];
	next?: LivePlan;
}

export function fetchCrewsLive(
	fetcher: typeof fetch = fetch,
): Promise<ApiResult<{ crews: LiveCrew[] }>> {
	return loadApi(fetcher, '/api/crews/live');
}
