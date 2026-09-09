export interface Member {
	id: string;
	displayName: string;
	avatarUrl?: string;
	role: string;
	totalXp?: number;
	ftpWatts?: number;
	weightKg?: number;
	joinedAt?: string;
	/** Medals this room awarded them, lifetime — counted by id (#1371). */
	medals?: number;
}

export interface Medal {
	kind: string;
	rider: string;
	awardedAt: string;
}

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
 * Absent too while `crew_id` is nullable, which is one release (#1178).
 */
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
	/**
	 * A person has named it (#1151). Until then it carries the owner's name
	 * and the set-up step stays open — decided by the server, not by
	 * comparing the name to the owner's display name (audit 2026-09-09).
	 */
	named?: boolean;
}

/**
 * What a room row may say about itself without being opened (#1149). `open`
 * draws nothing — the absence of a mark is the state. `locked` and `admin`
 * are the two you cannot enter, and a row in either is not a link.
 */
export type RoomAccess = 'open' | 'private' | 'locked' | 'admin';

/**
 * One rider's week on a room's opt-in board (#995, ADR-0036). Category is a
 * bracket, not a rank — it says who is comparable, which is the useful half.
 */
export interface BoardRow {
	id: string;
	displayName: string;
	kj: number;
	seconds: number;
	category: string;
}

export interface Room {
	slug: string;
	name: string;
	listed: boolean;
	icon?: string;
	cheers?: string[];
	soundPack?: string;
	role?: string;
	/** The outsider's two facts (#1236): does the door open, are you in the crew. */
	canEnter?: boolean;
	inCrew?: boolean;
	/** Removed, at either level (audit 2026-09-09) — the door says so. */
	banned?: boolean;
	members?: Member[];
	/** Open to its crew (ADR-0038); members only, absent = shut. */
	crewVisible?: boolean;
	/** A private room's door list (#1224), owner only. */
	invited?: Member[];
	crewOutside?: Member[];
	medals?: Medal[];
	streakWeeks?: number;
	monthKj?: number;
	together?: Together;
	crew?: RoomCrew;
	boardEnabled?: boolean;
	board?: BoardRow[];
	upcoming?: {
		id: string;
		workoutName: string;
		workoutJson: string;
		startsAt: string;
		createdBy: string;
	}[];
	icsToken?: string;
}

export type RoomLoadData = { room: Room | null; roomError: string | null };

// The shapes the designed components share with the sidebar (moved from the
// mockcompat barrel, consolidation sweep 2026-09-09: one import path each).
/** Presence phases as the designed components speak them. */
export type Phase = 'lounge' | 'countdown' | 'live';

export interface Fault {
	/** 'mic' is the capture dying under an open microphone (#640). */
	kind: 'trainer' | 'room' | 'voice' | 'mic';
	/** 'silent' is trainer-only: connected, and delivering nothing (#520). */
	state: 'reconnecting' | 'lost' | 'silent';
}

/** RoomRail's room list entry. */
export interface RailRoom {
	name: string;
	/** Owner-set identity mark (#223), an icon key (#447); '' = none. */
	icon?: string;
	/**
	 * The door. A room you may not enter comes with no slug (#1205): the
	 * server keeps it, and this holds the room's id instead — a stable key
	 * for the row that routes nowhere, which is the point.
	 */
	slug: string;
	id?: string;
	live: boolean;
	members: number;
	/** Riders connected right now (server presence). */
	connected?: number;
	/** Their names, for the hover and the rooms page. */
	riders?: string[];
	/** The same riders by account id — names are not unique (#649). */
	riderIds?: string[];
	/** Who is in the voice channel (#149) — the radar's core signal. */
	voice?: string[];
	/** Camera-on names (#251), from LiveKit's track webhook. */
	cameras?: string[];
	/** Names with live watts right now — the watt dot (#251). */
	riding?: string[];
	/** The same riders by account id. */
	ridingIds?: string[];
	/** The running session — the late-join radar line (#251). */
	session?: { workoutName: string; elapsedSec: number };
	/** The next planned session, when one exists. */
	next?: { workoutName: string; startsAt: string };
	/** Lines from other people since you last opened it (#389). */
	unread?: number;
	/** The last thing said here (#468) — the messages list's preview and
	 * the recency a room sorts by next to a DM. */
	lastChat?: { from: string; text: string; hasImage?: boolean; at: number };
	/** The room's reaction palette (#223), icon keys — read from outside too. */
	cheers?: string[];
	/** owner | coach | member — the ownership cap counts against it. */
	role?: string;
	/** The crew this room belongs to (ADR-0038) — what the sidebar switches between. */
	crew?: RoomCrew;
	/** What you may do here without opening it (#1149). Absent = open. */
	access?: RoomAccess;
}
