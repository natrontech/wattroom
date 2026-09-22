import Eye from '@lucide/svelte/icons/eye';
import Lock from '@lucide/svelte/icons/lock';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import type { Icon } from '$lib/icons';
import type { RailRoom } from '$lib/room/room-data';
import type { RoomAccess, RoomCrew } from '$lib/room/room-data';

/**
 * The crew is a mode the sidebar is in (ADR-0020, amended 2026-09-08; #1147):
 * one crew's rooms at a time, and the column below keeps the two-deep shape
 * ADR-0020 sized for. Pure, so the one rule that must not regress — the room
 * you are standing in stays in the sidebar whichever crew is on screen — is
 * a function a test can break.
 */

const CHOSEN = 'wattroom.crew.v1';

/**
 * Every crew you are in, once each: the ones the server lists in their own
 * right first (#1476 — a crew with no rooms is still a crew, and deriving
 * crews from rooms made it vanish with its last room), then any a room
 * mentions that the list somehow does not.
 */
export function crewsOf(
	rooms: readonly RailRoom[],
	known: readonly RoomCrew[] = [],
): RoomCrew[] {
	const seen = new Map<string, RoomCrew>();
	for (const crew of known) if (!seen.has(crew.id)) seen.set(crew.id, crew);
	for (const room of rooms) {
		if (room.crew && !seen.has(room.crew.id)) seen.set(room.crew.id, room.crew);
	}
	return [...seen.values()];
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
 * What a crew you are NOT looking at is doing (#1148): riders with live
 * watts, people in voice, lines unread — over the channels you may enter
 * (crew-live.svelte.ts `livePulse`), never a signal from one you may not.
 */
export interface CrewPulse {
	riding: number;
	voice: number;
	unread: number;
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
 * Whether the rider has nowhere to open a room — no crew of their own, and
 * none they administer (#2176).
 *
 * The one question three surfaces were each answering differently: Home's
 * button read `!presence.crews.length` (false for a plain member of somebody
 * else's crew), the sheet's order read `openableCrews(...).length === 0`, and
 * the dialog's own name asked nothing at all. So a crewless rider pressed
 * "Join a crew" and got a dialog announcing itself as "Open a room", and a
 * member pressed "Open a room" and got a sheet that led with joining one.
 */
export function administersNone(crews: readonly RoomCrew[]): boolean {
	return openableCrews(crews).length === 0;
}

/**
 * Whether the open-or-join sheet and Home's big button lead with joining a
 * crew (#2184, ADR-0038 amended 2026-09-17).
 *
 * The invite is the key, not administering nothing: `pendingInvite` is the
 * one signal that somebody sent this rider to a door. A stranger who arrived
 * off the signed-out landing carries none, and that landing's single CTA
 * promises their own crew ("Start your crew", #2480) — so keying on
 * "administers nothing" made the front door promise one thing and Home hand
 * back a code box.
 *
 * `administersNone` still guards it, because the invite is read once with the
 * account: a rider who founds a crew in this session carries the stale code
 * until `/api/me` is read again, while the room list has already moved.
 */
export function leadsWithJoining(
	crews: readonly RoomCrew[],
	pendingInvite: string | null | undefined,
): boolean {
	return !!pendingInvite && administersNone(crews);
}

/**
 * How many crews count against docs/SPEC.md's founding cap: the ones you
 * founded and still own. Handing one on frees its slot; a crew handed to you
 * never takes one.
 */
export function foundedCount(crews: readonly RoomCrew[]): number {
	return crews.filter((c) => c.founded && c.role === 'owner').length;
}
