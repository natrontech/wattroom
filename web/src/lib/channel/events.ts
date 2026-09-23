import { awayLineFor } from '$lib/away';
import { gameMode } from '$lib/session/modes';
import { formatWhen } from '$lib/format';
import type { ChannelEvent } from '$lib/protocol';

/**
 * What a voice channel says happened in it (#321): the lines under the
 * lounge. Events are ephemeral (ADR-0019) and carry no reactions — they are
 * quieter than a message by design, Discord's join/leave shape.
 */

/**
 * The room's own wording for one event. Vocabulary is docs/SPEC.md's glossary
 * — a track is a track on every surface — and the title is the string the
 * dock shows, so both name the same thing. An unknown verb renders nothing:
 * a newer server may speak about things this client has never heard of.
 */
export function eventText(event: ChannelEvent): string {
	const track = event.track || 'a track';
	const subject = event.subject || 'a session';
	// One wording for a planned moment across the app: the chat line and the
	// card in the lounge name the same time the same way.
	const at = event.when
		? formatWhen(new Date(event.when).toISOString(), true)
		: '';
	// Stepping out is one family of verbs — `away`, `away_nature`,
	// `away_food`, `away_shower` — and $lib/away owns the sentence for each,
	// beside the label the menu shows and the mark the tile draws (#706). A
	// verb from a newer server draws no line rather than a wrong one.
	if (event.verb.startsWith('away')) {
		return awayLineFor(event.verb, event.actor ?? '') ?? '';
	}
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
		case 'back':
			return `${event.actor} is back`;
		case 'started':
			return `${subject} is starting`;
		case 'ended':
			return `${subject} ended`;
		// A game's end (#1575): the subject is the mode's id, labelled here.
		case 'won':
			return `${event.actor} won ${gameMode(event.subject ?? '')?.label ?? subject}`;
		// The same end with nobody to name (#2235): a collective ramp ends on
		// the room's average, not on one rider outlasting the rest, and the
		// coach's end is the only end Team Relay has. The count is the round
		// it reached — for a collective ramp, the score the room rode for.
		case 'gameEnded': {
			const mode = gameMode(event.subject ?? '')?.label ?? subject;
			return event.count > 1
				? `${mode} ended after ${event.count} rounds`
				: `${mode} ended`;
		}
		// 'due' is the one line no server sends: the hub does not know the
		// schedule, so each client derives the reminder from the same upcoming
		// list the lounge card renders.
		case 'due':
			return `${subject} starts at ${at}`;
		// A DM that arrived while this rider was riding (#1743, $lib/channel/dm-line)
		// — this client's own line too, and the sender without the words.
		case 'messaged':
			return `${event.actor} sent you a message`;
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
