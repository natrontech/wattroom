import Dices from '@lucide/svelte/icons/dices';
import Flame from '@lucide/svelte/icons/flame';
import Trophy from '@lucide/svelte/icons/trophy';
import Target from '@lucide/svelte/icons/target';
import TrendingUp from '@lucide/svelte/icons/trending-up';
import Star from '@lucide/svelte/icons/star';
import Users from '@lucide/svelte/icons/users';
import Zap from '@lucide/svelte/icons/zap';
import type { Icon } from '$lib/icons';
import {
	WheelraceMaxMinutes,
	WheelraceMinMinutes,
	type Control,
} from '$lib/protocol';

/**
 * The seven game modes, one home (#458) — the picker that starts one and the
 * panel that runs it used to keep their own name lists, and they drifted.
 * Every blurb is docs/SPEC.md's parameter table in one line; the icon is the
 * mode's mark, chrome that never glows (ADR-0005).
 */
export interface GameMode {
	id: string;
	label: string;
	blurb: string;
	icon: Icon;
}

/** docs/SPEC.md: elimination modes forgive a disconnect this long. */
export const DISCONNECT_GRACE_SECONDS = 30;
/** The modes that eliminate — the grace and the "you're out" state are theirs. */
export const ELIMINATION_MODES = new Set([
	'backyard-ramp',
	'collective-ramp',
	'floor-is-lava',
]);

export const GAME_MODES: GameMode[] = [
	{
		id: 'backyard-ramp',
		label: 'Backyard Ramp',
		blurb:
			'Survive the ramp — every 3-min round adds 5 % FTP. Last rider standing.',
		icon: TrendingUp,
	},
	{
		id: 'collective-ramp',
		label: 'Collective Ramp',
		blurb: 'The same ramp, held by the session average — you survive together.',
		icon: Users,
	},
	{
		id: 'floor-is-lava',
		label: 'Floor is Lava',
		blurb:
			'Stay in the called zone. More than 5 s outside burns a life; three lives.',
		icon: Flame,
	},
	{
		id: 'watt-golf',
		label: 'Watt Golf',
		blurb:
			'Hit the called watts with the meter hidden — lowest deviation wins the hole.',
		icon: Target,
	},
	{
		id: 'sprint-roulette',
		label: 'Sprint Roulette',
		blurb:
			'A klaxon, 3 s warning, then 10–15 s flat out. Best 5 s w/kg takes it.',
		icon: Dices,
	},
	{
		id: 'points-race',
		label: 'Points Race',
		blurb:
			'Sprint points, execution points, zone-streak points — most points wins.',
		icon: Star,
	},
	{
		id: 'team-relay',
		label: 'Team Relay',
		blurb:
			'One rider on front at 110 % FTP, the rest sit in — rotate, rack up distance.',
		icon: Zap,
	},
];

/**
 * The races (ADR-0067): game modes on a road, started from the picker's
 * Roads tab with Race it (#3777), and named here so a running one reads by
 * its name (#3174). The ids are the hub's; each blurb is docs/SPEC.md
 * "Races" in one line.
 */
export const RACES: GameMode[] = [
	{
		id: 'race',
		label: 'Race',
		blurb: 'First over the line on W/kg, placed within your Category, D to A.',
		icon: Trophy,
	},
	{
		id: 'last-light',
		label: 'Last Light',
		blurb:
			'Farthest when the clock runs out. The fog closes in over the final minute.',
		icon: Trophy,
	},
	{
		id: 'wheelrace',
		label: 'Wheelrace',
		blurb:
			'Head starts from your race FTP: ridden at par, the field meets at the line.',
		icon: Trophy,
	},
];

/** docs/SPEC.md "Races": Last Light's clock, in minutes. */
export const LAST_LIGHT_MINUTES = [10, 20, 30];

/** A game to start: the control's own fields (#3777). */
export type GameStart = Required<Pick<Control, 'gameMode'>> &
	Pick<Control, 'route' | 'minutes'>;

/**
 * The race asked for, but its road: Last Light on its clock, a Wheelrace on
 * its par, and null for a par the hub refuses (docs/SPEC.md "Races").
 */
export function raceStart(
	mode: string,
	clock: number,
	par: number | null,
): Omit<GameStart, 'route'> | null {
	if (mode === 'last-light') return { gameMode: mode, minutes: clock };
	if (mode !== 'wheelrace') return { gameMode: mode };
	return par !== null &&
		Number.isInteger(par) &&
		par >= WheelraceMinMinutes &&
		par <= WheelraceMaxMinutes
		? { gameMode: mode, minutes: par }
		: null;
}

const BY_ID = new Map([...GAME_MODES, ...RACES].map((mode) => [mode.id, mode]));

/** The mode a wire id means, or undefined for one this client does not know. */
export function gameMode(id: string): Omit<GameMode, 'blurb'> | undefined {
	return BY_ID.get(id);
}
