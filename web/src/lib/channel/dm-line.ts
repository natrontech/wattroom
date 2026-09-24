import type { ChannelEvent } from '$lib/protocol';

/**
 * A DM that arrived while the rider was on the bike (#1743), written into the
 * channel's timeline instead of thrown across the riding screen as a toast.
 *
 * This client's own line, never the server's — a DM is between two people and
 * the channel knows nothing of it. Channel events are ephemeral and never
 * persisted (ADR-0022), so it stays on this one screen and reaches nobody
 * else in the channel, which is the only reason a private message may be
 * written there at all.
 *
 * The sender, never the words. The toast this replaces went away by itself; a
 * riding screen is a screen a rider sets up to be readable from three metres
 * away, and sometimes a television.
 */
export function dmArrivalEvent(
	from: string,
	at: number,
	// A poke lands the same way (#2721), and its line says who poked.
	verb: 'messaged' | 'poked' = 'messaged',
): ChannelEvent {
	return {
		// The moment is in the id: two messages from the same person are two
		// lines, the way two chat lines are.
		id: `dm:${from}:${at}`,
		kind: 'dm',
		verb,
		actor: from,
		count: 1,
		at,
	};
}
