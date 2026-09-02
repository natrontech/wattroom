import {
	Bike,
	Coffee,
	Flame,
	Headphones,
	Moon,
	Music,
	Skull,
	Sunrise,
	Users,
	Zap,
} from '@lucide/svelte';
import type { Icon } from '$lib/icons';

/**
 * The achievement catalogue (#467) — the client's copy of
 * server/internal/gamify/catalogue.go. The server's catalogue_test.go holds
 * the two to the same keys, icons and XP, in the same order; the server
 * decides who earned what, this file only knows how to draw it. Every
 * number is docs/SPEC.md's.
 */
export interface AchievementMeta {
	key: string;
	name: string;
	how: string;
	icon: Icon;
	xp: number;
	/** What a progress count is in, when it is not simply a count. */
	unit?: string;
}

export const ACHIEVEMENTS: AchievementMeta[] = [
	{
		key: 'sunrise-club',
		name: 'Sunrise Club',
		how: '5 rides started before 07:00, server time',
		icon: Sunrise,
		xp: 100,
	},
	{
		key: 'night-shift',
		name: 'Night Shift',
		how: '5 rides ended after 23:00, server time',
		icon: Moon,
		xp: 100,
	},
	{
		key: '200-rides',
		name: '200 Rides',
		how: 'Two hundred rides on WattRoom',
		icon: Bike,
		xp: 500,
	},
	{
		key: 'sufferfest-survivor',
		name: 'Sufferfest Survivor',
		how: '45 minutes at or above FTP in one ride',
		icon: Skull,
		xp: 500,
	},
	{
		key: 'hot-end',
		name: 'Hot End',
		how: '3 minutes in Z6 in one ride',
		icon: Flame,
		xp: 250,
	},
	{
		key: 'espresso-ride',
		name: 'Espresso Ride',
		how: 'A ride under 25 minutes, 80 % of it above sweet spot',
		icon: Coffee,
		xp: 250,
	},
	{
		key: 'lounge-lizard',
		name: 'Lounge Lizard',
		how: '10 hours in a lounge, in voice',
		icon: Headphones,
		xp: 250,
		unit: 'min',
	},
	{
		key: 'dj',
		name: 'DJ',
		how: 'Queue 50 tracks the room played to the end',
		icon: Music,
		xp: 250,
	},
	{
		key: 'crew-chief',
		name: 'Crew Chief',
		how: 'Coach 20 sessions with 3+ riders',
		icon: Users,
		xp: 500,
	},
	{
		key: 'sprint-snob',
		name: 'Sprint Snob',
		how: 'Win 10 sprint moments on w/kg',
		icon: Zap,
		xp: 250,
	},
];

export const ACHIEVEMENT_BY_KEY: ReadonlyMap<string, AchievementMeta> = new Map(
	ACHIEVEMENTS.map((a) => [a.key, a]),
);
