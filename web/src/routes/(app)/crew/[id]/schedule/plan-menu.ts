import type { MenuEntry } from '$lib/context-menu.svelte';
import type { CrewPlan } from '$lib/crew-schedule';
import type { RsvpAnswer } from '$lib/session/rsvp';
import { shareVerb } from '$lib/share';
import CalendarClock from '@lucide/svelte/icons/calendar-clock';
import CircleX from '@lucide/svelte/icons/circle-x';
import Link from '@lucide/svelte/icons/link';
import Play from '@lucide/svelte/icons/play';
import UserCheck from '@lucide/svelte/icons/user-check';
import UserMinus from '@lucide/svelte/icons/user-minus';

/** What a plan row can do, as the Schedule page does it. */
export interface PlanActions {
	answer: RsvpAnswer | null;
	choose: (word: RsvpAnswer) => void;
	share: () => void;
	/** Move… and Cancel are the planner's and the crew's admins' (#2440). */
	rearranges: boolean;
	move: () => void;
	cancel: () => void;
	/** Why Start now is greyed — '' when it may run. */
	startHint: string;
	start: () => void;
	busy: boolean;
}

/**
 * A plan row's right-click (ux.md, #2514; first on the old Sessions page,
 * #1373). The row's buttons keep the primary actions; this holds all of them
 * plus the link the row has no space for, and a greyed entry names why.
 */
export function planEntries(act: PlanActions): MenuEntry[] {
	// Both answers, always both (#1011): a menu that offered only the one you
	// had not given could not say where you stood.
	const entries: MenuEntry[] = [
		{
			label: "I'm in",
			icon: UserCheck,
			onSelect: () => act.choose('in'),
			hint: act.answer === 'in' ? 'your answer' : undefined,
		},
		{
			label: "I'm out",
			icon: UserMinus,
			onSelect: () => act.choose('out'),
			hint: act.answer === 'out' ? 'your answer' : undefined,
		},
		{ label: `${shareVerb()} link`, icon: Link, onSelect: act.share },
		'separator',
		{
			label: 'Start now',
			icon: Play,
			onSelect: act.start,
			disabled: !!act.startHint || act.busy,
			hint: act.startHint || undefined,
		},
	];
	if (!act.rearranges) return entries;
	entries.push(
		{
			label: 'Move…',
			icon: CalendarClock,
			onSelect: act.move,
			disabled: act.busy,
		},
		'separator',
		{
			label: 'Cancel the session',
			icon: CircleX,
			onSelect: act.cancel,
			danger: true,
			disabled: act.busy,
		},
	);
	return entries;
}

/** Why a plan's Start now is greyed, or '' when it may run — the row's own
 *  rule for its button, worded for the menu. */
export function startHint(
	plan: Pick<CrewPlan, 'channelId'>,
	o: {
		due: boolean;
		spectator: boolean;
		/** A voice channel the rider may enter exists to start a plan that
		 *  names none in — its row offers the choice (#2607). */
		voiceChannels: boolean;
		/** Who coaches a session in its channel right now (#2606). */
		coaching?: string;
	},
): string {
	// The cockpit stays on the screen a coach rides on (#1767).
	if (o.spectator) return 'start it from the screen you ride on';
	if (!o.due) return 'not due yet';
	if (o.coaching) return `${o.coaching} is coaching a session there`;
	if (!plan.channelId && !o.voiceChannels)
		return 'this crew has no voice channel you can start it in';
	return '';
}
