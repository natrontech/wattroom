/**
 * The three things every person in WattRoom already carries: their page, the
 * DM thread, and the ask to be friends. Built in one place so a friend in the
 * sidebar and a member of a room say the same words in the same order (#486).
 */
import BellRing from '@lucide/svelte/icons/bell-ring';
import MessageSquare from '@lucide/svelte/icons/message-square';
import ShieldBan from '@lucide/svelte/icons/shield-ban';
import User from '@lucide/svelte/icons/user';
import UserPlus from '@lucide/svelte/icons/user-plus';
import Volume2 from '@lucide/svelte/icons/volume-2';
import { api } from '$lib/api';
import type { MenuEntry, MenuItem, MenuSlider } from '$lib/context-menu.svelte';
import { roomConnection } from '$lib/room/connection.svelte';
import { RIDER_FADER } from '$lib/sound/fader';
import { mixer } from '$lib/sound/mixer.svelte';
import { toasts } from '$lib/toast.svelte';

/**
 * Asking by id is allowed across a shared room (ADR-0024), so the menu never
 * needs the friend code. It also never needs to know whether you are already
 * friends: the server answers that itself, in a sentence worth showing —
 * "There is already a request or friendship with them." One line either way
 * beats a roster-wide friendship fetch nobody else would use.
 */
async function askToBeFriends(id: string): Promise<void> {
	const res = await api('/api/friends', {
		method: 'POST',
		json: { userId: id },
	});
	if (res.ok) toasts.push('Friend request sent.');
	else toasts.push(res.error.message, { tone: 'error' });
}

/**
 * A rider's volume travels with the rider (#874), instead of living on the two
 * rows that used to render a speaker icon. The caller says when they are in
 * voice, because that is the room's answer and not the menu's — a fader that
 * changes nothing you can hear is noise. Written through `av` when there is
 * one, so the gain ramps while you drag.
 */
function riderVolume(id: string, name: string): MenuSlider {
	return {
		kind: 'slider',
		label: 'Volume',
		icon: Volume2,
		...RIDER_FADER,
		value: Math.round(mixer.riderGain(id) * 100),
		format: (percent) => `${percent}%`,
		onInput: (percent) => {
			const gain = percent / 100;
			const av = roomConnection.current?.av;
			if (av) av.setRiderGain(id, gain, name);
			else mixer.setRiderGain(id, gain, name);
		},
	};
}

export function personMenu(
	id: string,
	go: (href: string) => void,
	options: {
		/** The object IS the conversation — a DM head, not a person. */
		conversation?: boolean;
		/** You: there is no DM to yourself, and no friending yourself. */
		you?: boolean;
		/** Present only on a room surface; disabled explains why it cannot land. */
		poke?: {
			onSelect: () => void;
			disabled?: boolean;
			hint?: string;
		};
		/** Their volume, offered only where they are in voice to hear it. */
		volume?: { name: string };
		/** The room's own moderation, passed only by an owner. */
		ban?: () => void;
	} = {},
): MenuEntry[] {
	const riderPage: MenuItem = {
		label: 'Rider page',
		icon: User,
		onSelect: () => go(`/u/${id}`),
	};
	const message: MenuItem = {
		label: options.conversation ? 'Open the conversation' : 'Message',
		icon: MessageSquare,
		onSelect: () => go(`/messages/dm/${id}`),
		disabled: options.you,
	};
	const friend: MenuItem = {
		label: 'Add friend',
		icon: UserPlus,
		onSelect: () => void askToBeFriends(id),
		disabled: options.you,
	};
	const poke: MenuItem | undefined = options.poke && {
		label: 'Poke',
		icon: BellRing,
		onSelect: options.poke.onSelect,
		disabled: options.you || options.poke.disabled,
		hint: options.you ? "that's you" : options.poke.hint,
	};
	// The menu leads with what a click on the object already does.
	const items: MenuEntry[] = options.conversation
		? [message, riderPage, friend]
		: [riderPage, message, friend];
	if (poke) items.splice(2, 0, poke);
	// After the room's own verbs, before the friendship: the fader is what you
	// came for mid-ride, but the list still reads person-first.
	if (options.volume && !options.you)
		items.splice(items.length - 1, 0, riderVolume(id, options.volume.name));
	// Last, after a separator (ux.md). The tile used to append this itself, so
	// the same griefer was bannable from their tile and not from the roster row
	// two hundred pixels away (#951).
	if (options.ban && !options.you)
		items.push('separator', {
			label: 'Ban from the room',
			icon: ShieldBan,
			onSelect: options.ban,
			danger: true,
		});
	return items;
}
