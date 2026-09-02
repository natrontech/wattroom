/**
 * The two navigations every person in WattRoom already carries: their page
 * and the DM thread. Built in one place so a friend in the sidebar and a
 * member of a room say the same words in the same order (#486).
 */
import { MessageSquare, User } from '@lucide/svelte';
import type { MenuItem } from '$lib/context-menu.svelte';

export function personMenu(
	id: string,
	go: (href: string) => void,
	options: {
		/** The object IS the conversation — a DM head, not a person. */
		conversation?: boolean;
		/** You: there is no DM to yourself. */
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
	// The menu leads with what a click on the object already does.
	return options.conversation ? [message, profile] : [profile, message];
}
