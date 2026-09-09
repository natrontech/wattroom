import Eye from '@lucide/svelte/icons/eye';
import Lock from '@lucide/svelte/icons/lock';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import type { Icon } from '$lib/icons';
import type { RailRoom } from '$lib/room/mockcompat';
import type { RoomAccess, RoomCrew } from '$lib/room/room-data';

/**
 * The crew is a mode the sidebar is in (ADR-0020, amended 2026-09-08; #1147):
 * one crew's rooms at a time, and the column below keeps the two-deep shape
 * ADR-0020 sized for. Pure, so the one rule that must not regress — the room
 * you are standing in stays in the sidebar whichever crew is on screen — is
 * a function a test can break.
 */

const CHOSEN = 'wattroom.crew.v1';

/** The crews the room list mentions, once each, in the order they appear. */
export function crewsOf(rooms: readonly RailRoom[]): RoomCrew[] {
	const seen = new Map<string, RoomCrew>();
	for (const room of rooms) {
		if (room.crew && !seen.has(room.crew.id)) seen.set(room.crew.id, room.crew);
	}
	return [...seen.values()];
}

/**
 * Which crew is on screen. The chosen one when it is still one of yours,
 * else the crew of the room you are standing in, else the first. A choice
 * that names a crew you have since left must not blank the sidebar.
 */
export function currentCrew(
	crews: readonly RoomCrew[],
	chosen: string | null,
	rooms: readonly RailRoom[],
	connectedSlug: string,
): RoomCrew | null {
	if (chosen) {
		const hit = crews.find((c) => c.id === chosen);
		if (hit) return hit;
	}
	const standing = rooms.find((r) => r.slug === connectedSlug)?.crew;
	if (standing) return crews.find((c) => c.id === standing.id) ?? null;
	return crews[0] ?? null;
}

export interface SidebarGroups {
	/**
	 * The room you are connected to, when it belongs to a crew other than the
	 * one on screen — pinned above the list under "you are in · <crew>".
	 * Without it, switching crews mid-session drops the room you are
	 * connected to out of the navigation and folds Training two clicks away
	 * (rider report #416).
	 */
	pinned: RailRoom | null;
	/** The current crew's rooms — plus any room with no crew, always. */
	rooms: RailRoom[];
}

export function sidebarGroups(
	rooms: readonly RailRoom[],
	current: RoomCrew | null,
	connectedSlug: string,
): SidebarGroups {
	// A crewless room (the one-release nullable window, ADR-0038's fourth
	// amendment) belongs to no mode and is never hidden by one.
	const shown = rooms.filter(
		(r) => !r.crew || !current || r.crew.id === current.id,
	);
	const standing = rooms.find((r) => r.slug === connectedSlug);
	const pinned =
		standing && !shown.some((r) => r.slug === standing.slug) ? standing : null;
	return { pinned, rooms: shown };
}

export function readChosenCrew(): string | null {
	try {
		return localStorage.getItem(CHOSEN);
	} catch {
		return null;
	}
}

export function rememberChosenCrew(id: string): void {
	try {
		localStorage.setItem(CHOSEN, id);
	} catch {
		/* fine — the sidebar opens on the room you are in next time */
	}
}

/**
 * The mark a room row draws for its access state (#1149), shared by the
 * sidebar and the crew page so the two cannot disagree. Open draws nothing.
 */
export function accessMark(
	access: RoomAccess | undefined,
): { icon: Icon; label: string } | null {
	switch (access) {
		case 'private':
			return { icon: Eye, label: 'private' };
		case 'locked':
			return { icon: Lock, label: 'private — you are not in this room' };
		case 'admin':
			return {
				icon: SlidersHorizontal,
				label: 'yours to administer, not to enter',
			};
		default:
			return null;
	}
}

/** A room you cannot enter is not a link (#1149, ux.md). */
export function reachable(access: RoomAccess | undefined): boolean {
	return access !== 'locked' && access !== 'admin';
}

/**
 * The day-one card (#1151) is shown once per crew you own and does not
 * return. ponytail: dismissed per device; a server-side flag is the upgrade
 * if seeing it twice across devices ever matters.
 */
const INTRO = 'wattroom.crew-intro.v1';

function introSeen(): string[] {
	try {
		const raw = localStorage.getItem(INTRO);
		const ids = raw ? (JSON.parse(raw) as unknown) : [];
		return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

export function introDismissed(crewId: string): boolean {
	return introSeen().includes(crewId);
}

export function dismissIntro(crewId: string): void {
	try {
		localStorage.setItem(
			INTRO,
			JSON.stringify([...new Set([...introSeen(), crewId])]),
		);
	} catch {
		/* fine — the card comes back next time, which is the safe direction */
	}
}

/**
 * What a crew you are NOT looking at is doing, summed over its rooms
 * (#1148): riders with live watts, people in voice, lines unread. Only rooms
 * you are a member of carry presence, so a crew's pulse is the part of it
 * you could already see — never a signal from a room you never joined.
 */
export interface CrewPulse {
	riding: number;
	voice: number;
	unread: number;
}

export function crewPulse(
	rooms: readonly RailRoom[],
	crewId: string,
): CrewPulse {
	return rooms
		.filter((r) => r.crew?.id === crewId)
		.reduce(
			(a, r) => ({
				riding: a.riding + (r.riding?.length ?? 0),
				voice: a.voice + (r.voice?.length ?? 0),
				unread: a.unread + (r.unread ?? 0),
			}),
			{ riding: 0, voice: 0, unread: 0 },
		);
}

/** A crew doing nothing says nothing: the icon alone, no zeroes. */
export function quiet(pulse: CrewPulse): boolean {
	return !pulse.riding && !pulse.voice && !pulse.unread;
}

/**
 * The crews you may open a room in (#1201): the one you own and any you
 * administer — Discord's Manage Channels. A member of a crew opens rooms in
 * their own crew, not the one they are looking at.
 */
export function openableCrews(crews: readonly RoomCrew[]): RoomCrew[] {
	return crews.filter((c) => c.role === 'owner' || c.role === 'admin');
}

/**
 * Where a new room lands: the crew on screen when you may open rooms there,
 * else your own, else whichever you administer. Null while the room list has
 * not landed — the server then defaults to your own crew.
 */
export function creationCrew(
	openable: readonly RoomCrew[],
	preferred: string | undefined,
): RoomCrew | null {
	return (
		openable.find((c) => c.id === preferred) ??
		openable.find((c) => c.role === 'owner') ??
		openable[0] ??
		null
	);
}
