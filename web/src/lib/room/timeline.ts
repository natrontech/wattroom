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
	switch (event.verb) {
		case 'queued':
			// A burst is one line: "queued 8 tracks", never eight lines that
			// push the actual conversation off the screen.
			return event.count > 1
				? `${event.actor} queued ${event.count} tracks`
				: `${event.actor} queued ${track}`;
		case 'removed':
			return `${event.actor} removed ${track}`;
		case 'skipped':
			return `${event.actor} skipped ${track}`;
		case 'playing':
			return event.queuedBy
				? `now playing: ${track} — queued by ${event.queuedBy}`
				: `now playing: ${track}`;
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
