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
 * What the crew did together (#995, ADR-0036). Cooperative by construction:
 * sums over the whole room, plus the VIEWER's own turnout — no other rider's
 * ride-derived number is in here.
 */
export interface Crew {
	seconds: number;
	sessionsThisMonth: number;
	sessionsLastMonth: number;
	/** Oldest first: true where you were in that session. */
	attended: boolean[];
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
	members?: Member[];
	medals?: Medal[];
	streakWeeks?: number;
	monthKj?: number;
	crew?: Crew;
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
