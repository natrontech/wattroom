import type { Icon } from '$lib/icons';
import Coffee from '@lucide/svelte/icons/coffee';
import ShowerHead from '@lucide/svelte/icons/shower-head';
import Toilet from '@lucide/svelte/icons/toilet';
import Utensils from '@lucide/svelte/icons/utensils';

/**
 * The states behind the Away button's arrow (#706, and the split button).
 *
 * One home for all four of a state's words: the key on the wire
 * (`protocol.AwayReasons` in Go — the two lists are the same set and the server
 * drops anything not in its own), the menu's label, the mark drawn on the
 * rider's tile, and the line the voice channel's timeline writes. Scattering
 * them is how a screen ends up calling "Refuelling" something the timeline
 * calls something else, which docs/SPEC.md's glossary rule exists to stop.
 *
 * Plain away keeps the empty key and the cup it has always had: the button's
 * face never changes, so one tap always means the same thing.
 */
export type AwayReason = '' | 'nature' | 'food' | 'shower';

export type AwayState = {
	/** What the arrow's menu calls it. */
	label: string;
	icon: Icon;
	/** The timeline's sentence, with the rider's name in front. */
	line: (actor: string) => string;
};

export const AWAY_STATES: Record<AwayReason, AwayState> = {
	'': {
		label: 'Away',
		icon: Coffee,
		line: (actor) => `${actor} went away`,
	},
	nature: {
		label: 'Nature break',
		icon: Toilet,
		line: (actor) => `${actor} is taking a nature break`,
	},
	food: {
		label: 'Refuelling',
		icon: Utensils,
		line: (actor) => `${actor} is refuelling`,
	},
	shower: {
		label: 'Showering',
		icon: ShowerHead,
		line: (actor) => `${actor} is showering`,
	},
};

/** The named states, in menu order — plain away is the button's face, not a menu item. */
export const AWAY_CHOICES: Exclude<AwayReason, ''>[] = [
	'nature',
	'food',
	'shower',
];

/**
 * A reason off the wire, narrowed to one this build knows. A newer server's
 * word draws the plain cup rather than nothing: the rider is away either way,
 * and that is the part the voice channel needs to see.
 */
export function awayState(reason: string | undefined): AwayState {
	return AWAY_STATES[(reason ?? '') as AwayReason] ?? AWAY_STATES[''];
}

/**
 * The timeline verb the server writes for a state — `away` for the plain one,
 * `away_<reason>` for the rest. Kept beside the states themselves so adding
 * one is a single edit on each side of the wire.
 */
export function awayLineFor(verb: string, actor: string): string | undefined {
	if (verb === 'away') return AWAY_STATES[''].line(actor);
	if (!verb.startsWith('away_')) return undefined;
	const state = AWAY_STATES[verb.slice('away_'.length) as AwayReason];
	return state?.line(actor);
}
