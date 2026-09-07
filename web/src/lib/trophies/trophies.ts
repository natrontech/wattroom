/**
 * The trophy case's API shapes and copy (#467). One fetch for your own case
 * and for a rider's you share a room or a friendship with; docs/SPEC.md "XP
 * sources" is the vocabulary — presence is "in voice", never "talking".
 */
import { api, loadApi } from '$lib/api';

export interface TrophyProgress {
	have: number;
	need: number;
}

export interface TrophyAchievement {
	key: string;
	earnedAt?: string;
	/**
	 * Absent once earned, for the ride achievements, which have no count —
	 * and for every entry when the case belongs to someone else: progress is
	 * the rider's own business (ADR-0027).
	 */
	progress?: TrophyProgress;
}

/**
 * What a rider has done here, as counts. Every one is a row count, never a
 * summed XP amount: the SPEC pays lounge blocks past the daily cap at 0 XP so
 * the hours keep counting, and sprint wins, tracks and coached sessions are
 * paid 0 always — summed, the whole section would read as a rounding error.
 */
export interface TrophyCounts {
	voiceMinutes: number;
	groupSessions: number;
	coached: number;
	sprintWins: number;
	tracksPlayed: number;
}

export interface Trophies {
	xp: {
		total: number;
		rides: number;
		lounge: number;
		sessions: number;
		achievements: number;
	};
	counts: TrophyCounts;
	energyKj: number;
	medals: {
		diesel: number;
		metronome: number;
		hammer: number;
		lanterneRouge: number;
	};
	achievements: TrophyAchievement[];
}

/**
 * Your own case, or a rider's — the server decides who may look, and answers
 * a rider's with the earned badges only (ADR-0027).
 */
export function fetchTrophies(riderId?: string, fetcher?: typeof fetch) {
	const path = riderId
		? `/api/riders/${encodeURIComponent(riderId)}/trophies`
		: '/api/me/trophies';
	return fetcher ? loadApi<Trophies>(fetcher, path) : api<Trophies>(path);
}

/** docs/SPEC.md "XP sources", one row per ledger line the case shows. */
export const XP_SOURCES: {
	key: keyof Trophies['xp'];
	source: string;
	/** The same source as a label beside its number, where prose has no room. */
	short: string;
	rule: string;
}[] = [
	{
		key: 'rides',
		source: 'Riding',
		short: 'riding',
		rule: '1 kJ = 1 XP, plus execution and streak bonuses',
	},
	{
		key: 'lounge',
		source: 'Being in the lounge',
		short: 'in voice',
		rule: '1 XP per 5 min in voice, 24 a day at most',
	},
	{
		key: 'sessions',
		source: 'Riding together',
		short: 'sessions',
		rule: '5 XP per group session you were in voice for',
	},
	{
		key: 'achievements',
		source: 'Achievements',
		short: 'trophies',
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

/**
 * The counts as rows, in the order the profile reads them. `achievement` is
 * the badge the count feeds — the annotation, not the reason the row exists:
 * this section is where the number itself becomes readable, and the badge is
 * a note in the margin. A row without one is simply counted.
 */
export const RIDER_COUNTS: {
	key: keyof TrophyCounts;
	label: string;
	/** Minutes, rendered as hours. */
	hours?: boolean;
	achievement?: string;
}[] = [
	{
		key: 'voiceMinutes',
		label: 'in voice',
		hours: true,
		achievement: 'lounge-lizard',
	},
	{ key: 'groupSessions', label: 'group sessions' },
	{ key: 'coached', label: 'coached', achievement: 'crew-chief' },
	{ key: 'sprintWins', label: 'sprint wins', achievement: 'sprint-snob' },
	{ key: 'tracksPlayed', label: 'tracks played', achievement: 'dj' },
];
