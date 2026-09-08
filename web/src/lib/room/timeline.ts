import { formatWhen } from '$lib/format';
import type { RoomEvent, SessionRecap } from '$lib/protocol';

/**
 * The room's timeline (#321): what riders said, interleaved with what the
 * room did. Events are ephemeral (ADR-0019) and carry no reactions — they are
 * quieter than a message by design, Discord's join/leave shape.
 */

/** What the panel needs of a chat line; the store passes protocol ChatLines. */
export type TimelineMessage = {
	id?: string;
	from: string;
	/** Whose line this is, for own-message and "N new" exclusion (#672). */
	fromId?: string;
	text: string;
	imageId?: string;
	at: number;
	/** When the author last rewrote it (#865); absent for a line as sent. */
	editedAt?: number;
};

export type TimelineEntry =
	| { kind: 'message'; key: string; at: number; message: TimelineMessage }
	| { kind: 'event'; key: string; at: number; event: RoomEvent }
	// The one durable entry (ADR-0034): a finished session's card, which is
	// here again after a reload when every event above it is gone.
	| { kind: 'recap'; key: string; at: number; recap: SessionRecap };

/**
 * The room's own wording for one event. Vocabulary is docs/SPEC.md's glossary
 * — a track is a track on every surface — and the title is the string the
 * dock shows, so both name the same thing. An unknown verb renders nothing:
 * a newer server may speak about things this client has never heard of.
 */
export function eventText(event: RoomEvent): string {
	const track = event.track || 'a track';
	const subject = event.subject || 'a session';
	// One wording for a planned moment across the app: the chat line and the
	// card in the lounge name the same time the same way.
	const at = event.when
		? formatWhen(new Date(event.when).toISOString(), true)
		: '';
	switch (event.verb) {
		case 'queued':
			// A burst is one line: "queued 8 tracks", never eight lines that
			// push the actual conversation off the screen.
			return event.count > 1
				? `${event.actor} queued ${event.count} tracks`
				: `${event.actor} queued ${track}`;
		case 'queuedPlaylist':
			// A set is one line naming the set — fifty lines naming its tracks
			// is the same mistake the burst rule already fixed for adds.
			return `${event.actor} queued the playlist ${track} · ${event.count} tracks`;
		case 'removed':
			return `${event.actor} removed ${track}`;
		case 'skipped':
			return `${event.actor} skipped ${track}`;
		case 'restored':
			// The undo behind every destructive deck verb (#660). Without a
			// line here the log records the skip and not the taking-back, so
			// it does not merely go quiet — it stays wrong.
			return `${event.actor} put ${track} back`;
		case 'skippedPlaylist':
			return event.count > 0
				? `${event.actor} skipped the rest of ${track} · ${event.count} tracks`
				: `${event.actor} skipped the playlist ${track}`;
		case 'playing':
			return event.queuedBy
				? `now playing: ${track} — queued by ${event.queuedBy}`
				: `now playing: ${track}`;
		// The session's own half of the timeline (#359).
		case 'planned':
			return at
				? `${event.actor} planned ${subject} for ${at}`
				: `${event.actor} planned ${subject}`;
		case 'moved':
			return at
				? `${event.actor} moved ${subject} to ${at}`
				: `${event.actor} moved ${subject}`;
		case 'cancelled':
			return `${event.actor} cancelled ${subject}`;
		// Who came and went (#984, ADR-0022). Quieter than a message by
		// design: no reaction, no name badge, one line.
		case 'joined':
			return event.count > 1
				? `${event.actor} and ${event.count - 1} ${
						event.count === 2 ? 'other' : 'others'
					} joined`
				: `${event.actor} joined`;
		case 'left':
			return `${event.actor} left`;
		case 'away':
			return `${event.actor} went away`;
		case 'back':
			return `${event.actor} is back`;
		case 'started':
			return `${subject} is starting`;
		case 'ended':
			return `${subject} ended`;
		// 'due' is the one line no server sends: the hub does not know the
		// schedule, so each client derives the reminder from the same upcoming
		// list the lounge card renders.
		case 'due':
			return `${subject} starts at ${at}`;
		// A screen appearing (#664) — this client's own line, never the
		// server's: LiveKit is the only one who saw it.
		case 'shared':
			return `${event.actor} started sharing a screen`;
		case 'unshared':
			return `${event.actor} stopped sharing`;
		default:
			return '';
	}
}

/**
 * Merge messages and events into one chronological list. Both arrive in
 * order, so this is a merge, not a sort — and a tie puts the message first,
 * because the room reacting to what someone typed reads that way round.
 */
/**
 * @param mine the reader's own display name. Their own arrival is not news to
 * them — they are looking at the room they just walked into — and the same
 * goes for stepping out, which they did by pressing the button that says so
 * (#984). Everyone ELSE sees every line.
 */
/**
 * @param recaps finished sessions (ADR-0034), from the tick that wrote one and
 * from the backlog on every join after. Deduplicated by id, because a rider
 * who was standing in the room when it was written has it from both.
 */
export function roomTimeline(
	messages: TimelineMessage[],
	events: RoomEvent[] = [],
	mine?: string,
	recaps: SessionRecap[] = [],
): TimelineEntry[] {
	const lines: TimelineEntry[] = messages.map((message) => ({
		kind: 'message',
		key: message.id ?? `m:${message.at}:${message.from}`,
		at: message.at,
		message,
	}));
	for (const event of events) {
		if (event.kind === 'presence' && mine && event.actor === mine) continue;
		if (!eventText(event)) continue; // a verb this client cannot render
		lines.push({ kind: 'event', key: `e:${event.id}`, at: event.at, event });
	}
	const seen = new Set<string>();
	for (const recap of recaps) {
		if (seen.has(recap.id)) continue;
		seen.add(recap.id);
		lines.push({
			kind: 'recap',
			key: `r:${recap.id}`,
			// It belongs where the session ended, which is where the room was
			// talking about it.
			at: recap.endedAt,
			recap,
		});
	}
	return lines.sort((a, b) => a.at - b.at);
}
