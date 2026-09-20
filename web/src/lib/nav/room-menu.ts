import { goto } from '$app/navigation';
import type { MenuEntry } from '$lib/context-menu.svelte';
import { device } from '$lib/device.svelte';
import type { RailRoom } from '$lib/room/room-data';
import { reachable } from './crews';
import { placesFor } from './pages';
import { pins } from '$lib/pins/pins.svelte';
import DoorOpen from '@lucide/svelte/icons/door-open';
import LogOut from '@lucide/svelte/icons/log-out';

/**
 * What a room row offers beyond opening it (#465) — its places, and the
 * disconnect when you are standing in it.
 *
 * One builder, because the row has two homes: the sidebar, and the messages
 * list that stands in for the sidebar below md (#2171), where the rows had
 * arrived without their menus.
 */
export function roomMenu(
	room: Pick<RailRoom, 'slug' | 'access' | 'role'>,
	{ here, onLeave }: { here: boolean; onLeave?: () => void },
): MenuEntry[] {
	// A room you cannot enter is not a link that fails (#1149, ux.md): the
	// row stays, says why, and goes nowhere — and offers nothing here.
	if (!reachable(room.access)) return [];
	// A room open to the crew that you have not walked into yet (#1236) has
	// no places of yours and no chat you may read: its one action is the
	// door, and a menu that offered the rest would 403 on click (ux.md:
	// never render a button that will fail).
	if (!room.role)
		return [
			{
				label: 'Walk in',
				icon: DoorOpen,
				onSelect: () => void goto(`/r/${room.slug}`),
			},
		];
	const entries: MenuEntry[] = placesFor(
		device.narrow,
		pins.items.length > 0,
	).map((place) => ({
		label: place.label,
		icon: place.icon,
		onSelect: () => void goto(`/r/${room.slug}${place.path}`),
	}));
	// A disconnect, not a leaving: membership stays and so does the row. It
	// wore the danger token and the word the crew's real exit uses, and a
	// rider pressing it found the room still there (audit 2026-09-09).
	if (here && onLeave)
		entries.push('separator', {
			label: 'Disconnect',
			icon: LogOut,
			onSelect: onLeave,
		});
	return entries;
}
