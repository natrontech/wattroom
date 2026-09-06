/**
 * The three things every person in WattRoom already carries: their page, the
 * DM thread, and the ask to be friends. Built in one place so a friend in the
 * sidebar and a member of a room say the same words in the same order (#486).
 */
import {
	BellRing,
	MessageSquare,
	User,
	UserPlus,
	Volume2,
} from '@lucide/svelte';
import { api } from '$lib/api';
import type { MenuItem, MenuSlider } from '$lib/context-menu.svelte';
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
 * rows that used to render a speaker icon. Offered only for someone actually
 * in voice — a fader that changes nothing you can hear is noise — and written
 * through `av`, so their gain ramps while you drag.
 */
function riderVolume(id: string, name?: string): MenuSlider | undefined {
	const av = roomConnection.current?.av;
	if (!av || !(id in av.voice)) return undefined;
	return {
		kind: 'slider',
		label: 'Volume',
		icon: Volume2,
		...RIDER_FADER,
		value: Math.round(mixer.riderGain(id) * 100),
		format: (percent) => `${percent}%`,
		onInput: (percent) => av.setRiderGain(id, percent / 100, name),
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
		/** Who the volume fader belongs to, so the mixer can name them later. */
		name?: string;
	} = {},
): (MenuItem | MenuSlider)[] {
	const profile: MenuItem = {
		label: 'View profile',
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
	const items: (MenuItem | MenuSlider)[] = options.conversation
		? [message, profile, friend]
		: [profile, message, friend];
	if (poke) items.splice(2, 0, poke);
	const volume = options.you ? undefined : riderVolume(id, options.name);
	// After the room's own verbs, before the friendship: the fader is what you
	// came for mid-ride, but the list still reads person-first.
	if (volume) items.splice(items.length - 1, 0, volume);
	return items;
}
