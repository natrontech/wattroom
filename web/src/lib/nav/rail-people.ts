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
import User from '@lucide/svelte/icons/user';
import Users from '@lucide/svelte/icons/users';
import type { MenuEntry } from '$lib/context-menu.svelte';
import type { RailRoom } from '$lib/room/room-data';

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
 * anybody. The names go to the pages of the people the FEED says they are —
 * `riderIds` is index-aligned with `riders` (#649) — rather than to whoever a
 * member list happens to call that. Display names are not unique, and the
 * lookup this replaced answered with the wrong rider for two riders called
 * Dave, one member-gated fetch per click later (#2182).
 *
 * A name the feed gave no id for cannot become a page, so it is not offered
 * one; the roster entry counts it with the rest, which is where every rider
 * has a row anyway (#533).
 */
export function railPeopleMenu(
	room: Pick<RailRoom, 'riders' | 'riderIds'>,
	go: (href: string) => void,
	onRoster: () => void,
): MenuEntry[] {
	const { shown, more } = railPeople(room.riders);
	const ids = room.riderIds ?? [];
	const entries: MenuEntry[] = shown.flatMap((name, i) =>
		ids[i]
			? [
					{
						label: `${name}'s page`,
						icon: User,
						onSelect: () => go(`/u/${ids[i]}`),
					},
				]
			: [],
	);
	if (entries.length === 0) return [];
	const hidden = more + (shown.length - entries.length);
	if (hidden > 0)
		entries.push('separator', {
			label: 'Everyone who is here',
			icon: Users,
			hint: `+${hidden}`,
			onSelect: onRoster,
		});
	return entries;
}
