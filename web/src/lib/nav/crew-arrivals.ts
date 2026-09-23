import { api } from '$lib/api';
import type { LiveCrew } from '$lib/crews-live';
import type { Arrival } from '$lib/messages/announce';
import { sessionPath } from '$lib/channel/address';

/** Every session running in the rider's crews, by id. */
export function runningSessions(crews: LiveCrew[]): Set<string> {
	const ids = new Set<string>();
	for (const crew of crews)
		for (const channel of crew.channels)
			if (channel.session) ids.add(channel.session.id);
	return ids;
}

export interface Where {
	/** The path the rider is on. */
	here: string;
	/** The voice channel the live connection holds, if any. */
	connected?: string;
	/** Who is reading — their own line is never news. */
	me?: string;
	/** The window is in front (ADR-0042's "looking"). */
	looking: boolean;
}

/**
 * What a crew read has to say (#2457): a session that was not running on the
 * last read, and a text channel with unread whose last line is someone
 * else's. The room list said both for rooms (#1910, #568); a room is its
 * crew's channels now, so the crew read says them — and a click lands on the
 * session or the channel, never on a room.
 *
 * A voice channel the rider is standing in, or holding the connection to,
 * announces its own session (connection.svelte.ts) under the same tag, so
 * this one steps aside for it rather than saying it twice.
 */
export function crewArrivals(
	crews: LiveCrew[],
	seen: ReadonlySet<string>,
	where: Where,
): Arrival[] {
	const out: Arrival[] = [];
	for (const crew of crews) {
		for (const channel of crew.channels) {
			const session = channel.session;
			if (session && !seen.has(session.id)) {
				const href = sessionPath(crew.id, session.id);
				const inIt =
					where.connected === channel.id ||
					where.here.startsWith(`/crew/${crew.id}/v/${channel.id}`) ||
					where.here.startsWith(href);
				if (!inIt)
					out.push({
						kind: 'session',
						tag: `session-v:${channel.id}`,
						at: Date.now(),
						title: `${channel.name} · ${crew.name}`,
						body: session.workout
							? `${session.workout} is starting — saddle up`
							: 'The session is starting — saddle up',
						href,
						reading: false,
					});
			}
			const last = channel.last;
			if (channel.kind !== 'text' || !channel.unread || !last) continue;
			if (last.fromId === where.me) continue;
			const href = `/crew/${crew.id}/c/${channel.id}`;
			out.push({
				kind: 'chat',
				tag: `chat-c:${channel.id}`,
				at: last.at,
				title: `${last.from} · ${channel.name}`,
				body: last.text || (last.hasImage ? 'sent an image' : ''),
				href,
				reading: where.looking && where.here === href,
				// ADR-0042's answer: the channel's own chat, the request its
				// page sends. A string back is the refusal, said out loud.
				reply: {
					placeholder: `Reply in #${channel.name}`,
					send: async (text) => {
						const res = await api(`/api/channels/${channel.id}/chat`, {
							method: 'POST',
							json: { text },
						});
						return res.ok ? null : res.error.message;
					},
				},
			});
		}
	}
	return out;
}
