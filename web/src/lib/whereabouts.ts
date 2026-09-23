/**
 * Where someone is, said one way on the friends list and on a rider's page
 * (ADR-0012, re-keyed to channels by ADR-0058, #2516). The server names the
 * voice channel and its crew only when you may enter that channel; for any
 * other it says the state without the place, and so does this.
 */
import { voiceChannelPath } from '$lib/channels';

/** The wire's `channels.Place`: a voice channel and the crew it belongs to. */
export interface VoicePlace {
	crewId: string;
	crewName: string;
	channelId: string;
	channelName: string;
}

/** The presence both /api/friends and /api/riders/{id} carry. */
export interface Whereabouts {
	/** The app is open (the lobby socket, #251). */
	online?: boolean;
	/** In some voice channel, named or not. */
	inVoice?: boolean;
	/** Pedalling right now — never what they push, which stays in the session. */
	riding?: boolean;
	/** Only for a channel you may enter. */
	channel?: VoicePlace;
}

/**
 * "riding in Night Owls · Lounge", "riding elsewhere", "in a voice channel",
 * "online" — or '' when there is nothing to say. The crew comes first because
 * every crew opens with a Lounge. "Riding elsewhere" is ADR-0012's phrase: the
 * state, without piercing the gate. Riding is never inferred from standing in
 * a channel (#2168) — the server answers which of the two it is.
 */
export function whereabouts(p: Whereabouts): string {
	if (p.channel) {
		const where = `${p.channel.crewName} · ${p.channel.channelName}`;
		return p.riding ? `riding in ${where}` : `in ${where}`;
	}
	if (p.inVoice) return p.riding ? 'riding elsewhere' : 'in a voice channel';
	return p.online ? 'online' : '';
}

/** Where "Walk in" goes: the voice channel's page (`/crew/{id}/v/{channel}`). */
export const placePath = (place: VoicePlace) =>
	voiceChannelPath(place.crewId, place.channelId);
