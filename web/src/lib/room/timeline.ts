import { formatWhen } from '$lib/format';
import type { RoomEvent } from '$lib/protocol';

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
};

export type TimelineEntry =
	| { kind: 'message'; key: string; at: number; message: TimelineMessage }
	| { kind: 'event'; key: string; at: number; event: RoomEvent };

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
		case 'started':
			return `${subject} is starting`;
		case 'ended':
			return `${subject} ended`;
		// 'due' is the one line no server sends: the hub does not know the
		// schedule, so each client derives the reminder from the same upcoming
		// list the lounge card renders.
		case 'due':
			return `${subject} starts at ${at}`;
		default:
			return '';
	}
}

/**
 * Merge messages and events into one chronological list. Both arrive in
 * order, so this is a merge, not a sort — and a tie puts the message first,
 * because the room reacting to what someone typed reads that way round.
 */
export function roomTimeline(
	messages: TimelineMessage[],
	events: RoomEvent[] = [],
): TimelineEntry[] {
	const lines: TimelineEntry[] = messages.map((message) => ({
		kind: 'message',
		key: message.id ?? `m:${message.at}:${message.from}`,
		at: message.at,
		message,
	}));
	for (const event of events) {
		if (!eventText(event)) continue; // a verb this client cannot render
		lines.push({ kind: 'event', key: `e:${event.id}`, at: event.at, event });
	}
	return lines.sort((a, b) => a.at - b.at);
}
