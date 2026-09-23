/**
 * What a room's members did together (#995, ADR-0036). Not ADR-0038's crew,
 * which is the layer ABOVE a room — this is one room's own totals, and it
 * gave the word up rather than mean two things (#1178).
 *
 * Cooperative by construction:
 * sums over the whole room, plus the VIEWER's own turnout — no other rider's
 * ride-derived number is in here.
 */
export interface Together {
	seconds: number;
	sessionsThisMonth: number;
	sessionsLastMonth: number;
	/** Oldest first: true where you were in that session. */
	attended: boolean[];
}

/**
 * ADR-0038's crew: the layer above a room, and what the sidebar switches
 * between. Identity only — a crew carries no voice, deck, session or metrics.
 *
 * Members only, so it is absent for a room you are looking at from outside.
 * Absent too while `crew_id` is nullable (#1178), which it still is: the
 * amendment said one release, the insert that makes a room did not name the
 * column, and #1301 carries the corrected sequence.
 */
/** One line a coach marked, as every surface that draws it reads it. */
export interface Announcement {
	/** The marked message, so the strip can point back at the line. */
	messageId: string;
	text: string;
	/** The message's author, not whoever marked it. */
	from: string;
	/** ISO — the message's own timestamp, not the marking's. */
	at: string;
}

export interface RoomCrew {
	id: string;
	name: string;
	icon?: string;
	/** The crew's logo (#1237), drawn before the icon and the initial. */
	imageUrl?: string;
	/** The crew's join code (#1236) — members only; the TV shows it idle. */
	code?: string;
	/**
	 * What you are to the crew. `owner` is the un-removable one (ADR-0038,
	 * second amendment); it earns a small mark, not a louder row.
	 */
	role?: 'owner' | 'admin' | 'member';
	/** Founded by you — started by name (#2480) or minted with your first
	 * room (#1928): "your own crew", even once you own another after a
	 * hand-over. */
	founded?: boolean;
	/**
	 * A person has named it (#1151). Until then it carries the owner's name
	 * and the set-up step stays open — decided by the server, not by
	 * comparing the name to the owner's display name (audit 2026-09-09).
	 */
	named?: boolean;
	/**
	 * Deleting THIS room deletes the crew (#1935): it is the crew's only room
	 * and nobody but its owner is in it. Sent to the room's owner alone — the
	 * only caller who can delete it — and the delete confirm has to say so,
	 * because the crew's name, logo and invite link go with the room.
	 */
	goesWithRoom?: boolean;
}

/**
 * One rider's week on a room's opt-in board (#995, ADR-0036). Category is a
 * bracket, not a rank — it says who is comparable, which is the useful half.
 */
export interface BoardRow {
	id: string;
	displayName: string;
	kj: number;
	seconds: number;
	/**
	 * Absent while both the FTP and the weight it brackets are still the
	 * account's defaults (ADR-0048, #2243) — an unchosen number never reads
	 * as a measured one, and this board is the surface that publishes it to
	 * everyone else in the room. The row still ranks: kJ is ridden.
	 */
	category?: string;
}

/**
 * What YOU chose for this room, as its own object on the room (#1866): the
 * notifications and whether the soundboard reaches you. Declared here rather
 * than beside each of the two components that read it (#2180).
 */
export interface RiderPrefs {
	notify: boolean;
	onBoard: boolean;
}
