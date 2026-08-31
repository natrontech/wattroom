/**
 * One rider, several tabs (#293).
 *
 * LiveKit identities are `riderId#nonce` — one participant per connection, so
 * two tabs no longer evict each other. The room UI is keyed by rider, and the
 * mic and camera belong to exactly one tab at a time: the newest claim wins.
 */

const SEP = '#';

/** The person behind a participant identity. */
export function riderOf(identity: string): string {
	const cut = identity.indexOf(SEP);
	return cut === -1 ? identity : identity.slice(0, cut);
}

/** A tab's claim on its rider's mic and camera. */
export interface Claim {
	identity: string;
	/** When the claim was made — `Date.now()`, and same clock in every tab. */
	at: number;
}

/**
 * Does this tab step aside for that one? Only ever for another tab of the
 * same rider — a claim from someone else is none of our business.
 *
 * Newest wins, so opening a room moves the mic to the tab you are looking at.
 * Two tabs claiming in the same millisecond would otherwise both stand down
 * and leave the rider silent, so identical stamps fall back to comparing
 * identities: an arbitrary order, but one both tabs compute the same way.
 */
export function yieldsTo(mine: Claim, theirs: Claim): boolean {
	if (theirs.identity === mine.identity) return false;
	if (riderOf(theirs.identity) !== riderOf(mine.identity)) return false;
	if (theirs.at !== mine.at) return theirs.at > mine.at;
	return theirs.identity > mine.identity;
}

/** One of a rider's live connections, as far as the mic chip cares. */
export interface Connection {
	identity: string;
	micOpen: boolean;
}

/**
 * Is any connection of `rider` other than `except` holding an open mic?
 *
 * Muting in this app is unpublishing, and the room keys mic state by rider
 * while LiveKit reports it per connection — so the tab that stands down
 * announces an unpublish for a rider who is still live in the tab that took
 * over. Without this check the rider reads "mic off" everywhere, including in
 * the tab holding the mic.
 */
export function micLiveElsewhere(
	connections: Connection[],
	rider: string,
	except: string,
): boolean {
	return connections.some(
		(c) => c.identity !== except && riderOf(c.identity) === rider && c.micOpen,
	);
}
