import {
	Dices,
	Flame,
	Target,
	TrendingUp,
	Star,
	Users,
	Zap,
} from '@lucide/svelte';
import type { Icon } from '$lib/icons';

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
		blurb: 'The same ramp, held by the room average — you survive together.',
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

const BY_ID = new Map(GAME_MODES.map((mode) => [mode.id, mode]));

/** The mode a wire id means, or undefined for one this client does not know. */
export function gameMode(id: string): GameMode | undefined {
	return BY_ID.get(id);
}
