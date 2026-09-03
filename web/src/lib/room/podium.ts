import { Award, Medal, Trophy } from '@lucide/svelte';
import type { Icon } from '$lib/icons';

/**
 * The three places, one home (#458): the sprint podium and a game's final
 * standing both read from here, so first place is the same mark wherever the
 * room sees it. Shape carries the rank at arm's length — the neon weight only
 * reinforces it, and a place is chrome, so it never glows (ADR-0005).
 */
export interface Place {
	icon: Icon;
	/** Descending weight of the structural accent: first is the fullest. */
	tone: string;
	/** The icon is the whole label, so a screen reader gets this instead. */
	label: string;
}

export const PLACES: Place[] = [
	{ icon: Trophy, tone: 'text-neon', label: 'First place' },
	{ icon: Medal, tone: 'text-neon/75', label: 'Second place' },
	{ icon: Award, tone: 'text-neon/50', label: 'Third place' },
];
