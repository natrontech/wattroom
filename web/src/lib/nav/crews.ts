import type { RailRoom } from '$lib/room/mockcompat';
import type { RoomCrew } from '$lib/room/room-data';

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
