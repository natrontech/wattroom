/**
 * The three things every person in WattRoom already carries: their page, the
 * DM thread, and the ask to be friends. Built in one place so a friend in the
 * sidebar and a member of a room say the same words in the same order (#486).
 */
import { MessageSquare, User, UserPlus } from '@lucide/svelte';
import { api } from '$lib/api';
import type { MenuItem } from '$lib/context-menu.svelte';
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

export function personMenu(
	id: string,
	go: (href: string) => void,
	options: {
		/** The object IS the conversation — a DM head, not a person. */
		conversation?: boolean;
		/** You: there is no DM to yourself, and no friending yourself. */
		you?: boolean;
	} = {},
): MenuItem[] {
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
	// The menu leads with what a click on the object already does.
	return options.conversation
		? [message, profile, friend]
		: [profile, message, friend];
}
