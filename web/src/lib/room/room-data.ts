export interface Member {
	id: string;
	displayName: string;
	avatarUrl?: string;
	avatarPreset?: string;
	role: string;
	totalXp?: number;
	ftpWatts?: number;
	weightKg?: number;
	joinedAt?: string;
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
	/**
	 * What you are to the crew. `owner` is the un-removable one (ADR-0038,
	 * second amendment); it earns a small mark, not a louder row.
	 */
	role?: 'owner' | 'admin' | 'member';
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
	code?: string;
	role?: string;
	/** The outsider's two facts (#1236): does the door open, are you in the crew. */
	canEnter?: boolean;
	inCrew?: boolean;
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
