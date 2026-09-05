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
	upcoming?: {
		id: string;
		workoutName: string;
		workoutJson: string;
		startsAt: string;
		createdBy: string;
	}[];
	icsToken?: string;
}
