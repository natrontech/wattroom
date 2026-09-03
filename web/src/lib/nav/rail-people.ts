/**
 * The room row's second line in the sidebar (#438, #540): who is in a room you
 * are not standing in — and how one 10 px line of comma-joined names becomes
 * affordances a rider can hit.
 *
 * The line prints what 224 px has room for and counts the rest. Clicking it
 * opens the room's Members place, where every rider already has a thumb-sized
 * row, their page and `personMenu`; right-clicking it names the riders it
 * printed, one entry each. Splitting the line itself into three inline buttons
 * would make ~30x14 px targets, which ux.md forbids for someone on a bike, and
 * stacking the names Discord-style would quadruple every idle room's height and
 * cost the rail the glance it exists for (ADR-0010).
 */
import { User, Users } from '@lucide/svelte';
import type { MenuEntry } from '$lib/context-menu.svelte';
import type { RailRoom } from '$lib/room/mockcompat';

/** Names the line prints before it starts counting instead. */
export const RAIL_NAMES = 3;

export type RailSubline = 'session' | 'people' | 'next' | null;

/**
 * Which second line a room row shows. One function, because the people line is
 * a SIBLING of the room's link rather than a child of it — a button cannot nest
 * inside an anchor — and the two must never both render.
 */
export function railSubline(
	room: Pick<RailRoom, 'session' | 'riders' | 'next'>,
	open: boolean,
): RailSubline {
	if (open) return null;
	if (room.session) return 'session';
	if (room.riders?.length) return 'people';
	if (room.next) return 'next';
	return null;
}

/** The names the line prints, how many it hid, and how it reads. */
export function railPeople(riders: readonly string[] | undefined): {
	shown: string[];
	more: number;
	label: string;
} {
	const all = riders ?? [];
	const shown = all.slice(0, RAIL_NAMES);
	const more = all.length - shown.length;
	return {
		shown,
		more,
		label: shown.join(', ') + (more > 0 ? ` +${more}` : ''),
	};
}

/**
 * The line's own menu: the riders it named, then the roster when it hid
 * anybody. The rail carries display names and not ids, so a name cannot build
 * `personMenu` here — the entry resolves the name and lands on `/u/<id>`, which
 * is where message and add-friend live anyway (#533).
 */
export function railPeopleMenu(
	riders: readonly string[] | undefined,
	onMember: ((name: string) => void) | undefined,
	onRoster: () => void,
): MenuEntry[] {
	if (!onMember) return [];
	const { shown, more } = railPeople(riders);
	const entries: MenuEntry[] = shown.map((name) => ({
		label: `${name}'s page`,
		icon: User,
		onSelect: () => onMember(name),
	}));
	if (entries.length === 0) return [];
	if (more > 0)
		entries.push('separator', {
			label: 'Everyone who is here',
			icon: Users,
			hint: `+${more}`,
			onSelect: onRoster,
		});
	return entries;
}
