/**
 * The trophy case's API shapes and copy (#467). One fetch for your own case
 * and for a rider's you share a room or a friendship with; docs/SPEC.md "XP
 * sources" is the vocabulary — presence is "in voice", never "talking".
 */
import { api } from '$lib/api';

export interface TrophyProgress {
	have: number;
	need: number;
}

export interface TrophyAchievement {
	key: string;
	earnedAt?: string;
	/** Absent once earned, and for the ride achievements, which have no count. */
	progress?: TrophyProgress;
}

export interface Trophies {
	xp: {
		total: number;
		rides: number;
		lounge: number;
		sessions: number;
		achievements: number;
	};
	energyKj: number;
	medals: {
		diesel: number;
		metronome: number;
		hammer: number;
		lanterneRouge: number;
	};
	achievements: TrophyAchievement[];
}

/** Your own case, or a rider's — the server decides who may look. */
export function fetchTrophies(riderId?: string) {
	return api<Trophies>(
		riderId
			? `/api/riders/${encodeURIComponent(riderId)}/trophies`
			: '/api/me/trophies',
	);
}

/** docs/SPEC.md "XP sources", one row per ledger line the case shows. */
export const XP_SOURCES: {
	key: keyof Trophies['xp'];
	source: string;
	rule: string;
}[] = [
	{
		key: 'rides',
		source: 'Riding',
		rule: '1 kJ = 1 XP, plus execution and streak bonuses',
	},
	{
		key: 'lounge',
		source: 'Being in the lounge',
		rule: '1 XP per 5 min in voice, 24 a day at most',
	},
	{
		key: 'sessions',
		source: 'Riding together',
		rule: '5 XP per group session you were in voice for',
	},
	{
		key: 'achievements',
		source: 'Achievements',
		rule: '100–500 XP each, once',
	},
];

/** The medals payload keyed the way the SPEC names them. */
export const MEDAL_COUNT_KEY: Record<string, keyof Trophies['medals']> = {
	diesel: 'diesel',
	metronome: 'metronome',
	hammer: 'hammer',
	lanterne_rouge: 'lanterneRouge',
};
