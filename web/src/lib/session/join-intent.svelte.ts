/**
 * Joining a session is a choice (#4469, docs/SESSIONS.md): opening its page
 * watches it, and only a Join (a button on the page, a "Join the ride" link,
 * or the coach's own Start) puts the rider on its timeline. The choice is
 * this tab's, kept per session, so a join a reconnect lost is asked again,
 * and a Leave is never undone by the page.
 */

const JOIN = 'join';

/** What the door reads off an address: SvelteKit 3's `page.url` is read-only. */
type Address = {
	readonly href: string;
	readonly searchParams: { get(name: string): string | null };
};

/** Whether this address asks to join (`joinSessionPath`), and the address without the ask; null for none. */
export function takeJoinDoor(url: Address): { rest: URL } | null {
	if (url.searchParams.get(JOIN) === null) return null;
	const rest = new URL(url.href);
	rest.searchParams.delete(JOIN);
	return { rest };
}

/** At most one ask per this long while the hub still has the rider out. */
export const ASK_EVERY_MS = 3000;

/**
 * Whether the session page sends `join` now: the rider chose this session,
 * it is the one running, the hub does not have them in yet, and the last
 * ask was long enough ago. A phone spectates whatever it chose.
 */
export function shouldAskJoin(at: {
	chosen: string | null;
	here: string | undefined;
	running: string | undefined;
	inSession: boolean;
	spectator: boolean;
	now: number;
	askedAt: number;
}): boolean {
	if (at.spectator || at.inSession || !at.here) return false;
	if (at.chosen !== at.here || at.running !== at.here) return false;
	return at.now - at.askedAt >= ASK_EVERY_MS;
}

// The session this tab chose to ride, by id. One at a time: a device rides
// one session (ADR-0093).
let chosen = $state<string | null>(null);

export const joinIntent = {
	get chosen() {
		return chosen;
	},
	/** Join pressed, or a door that asks to: ride `session`. */
	choose(session: string) {
		chosen = session;
	},
	/** Leave the ride: watch `session` from here on. */
	drop(session: string) {
		if (chosen === session) chosen = null;
	},
};
