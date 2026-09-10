import { api, loadApi, type ApiResult } from '$lib/api';
import type { RoomAccess, RoomCrew } from '$lib/room/room-data';

/**
 * The crew's own surface (ADR-0038): identity, its rooms with what you may
 * do in each, its people with their crew roles, and — for the owner and
 * admins — its bans. Nothing live: a crew carries no voice, deck, session
 * or metrics, so there is nothing else to fetch.
 */
export type CrewRole = 'owner' | 'admin' | 'member';

export interface CrewPerson {
	id: string;
	displayName: string;
	avatarUrl?: string;
	role: CrewRole | 'banned';
	/** First joined any of the crew's rooms — or, on the ban list, banned on. */
	since: string;
	/** How many of the crew's rooms hold them; absent on the ban list. */
	rooms?: number;
	/** Owns a room in the crew, so cannot be banned from it (#1212). */
	ownsRoom?: boolean;
}

export interface CrewRoom {
	id: string;
	/** Absent when you may not enter — the slug is the door (#1205). */
	slug?: string;
	name: string;
	icon?: string;
	access: RoomAccess;
	/** In the public directory too (#1929). */
	listed?: boolean;
}

export interface Crew {
	id: string;
	name: string;
	icon?: string;
	/** The crew's logo (#1237), when one is set. */
	imageUrl?: string;
	/** The invite (#1236): the crew's code, shared as `/c/{code}`. */
	code?: string;
	/** What YOU are to it. */
	role: CrewRole;
	/** A person has named it (#1151); false while it carries the owner's name. */
	named?: boolean;
	ownerId: string;
	rooms: CrewRoom[];
	/**
	 * How many are in the crew — the door's number. `people` is the part of
	 * them you may see (#1135), shorter for a plain member.
	 */
	members?: number;
	people: CrewPerson[];
	/** Owner and admins only — a ban list is a moderation surface. */
	banned?: CrewPerson[];
}

export function fetchCrew(
	id: string,
	fetcher: typeof fetch = fetch,
): Promise<ApiResult<Crew>> {
	return loadApi<Crew>(fetcher, `/api/crews/${id}`);
}

/** The rename the day-one screen exists for (#1151); owner or admin. */
export function renameCrew(
	id: string,
	name: string,
	icon?: string,
): Promise<ApiResult<RoomCrew>> {
	return api<RoomCrew>(`/api/crews/${id}`, {
		method: 'PATCH',
		json: icon === undefined ? { name } : { name, icon },
	});
}

/**
 * admin | member | banned. `member` clears an admin grant or lifts a crew
 * ban — and lifts nothing a room's owner decided (#1150).
 */
export function setCrewRole(
	id: string,
	userId: string,
	role: 'admin' | 'member' | 'banned',
): Promise<ApiResult<void>> {
	return api<void>(`/api/crews/${id}/role`, {
		method: 'POST',
		json: { userId, role },
	});
}

/**
 * The deliberate hand-over (#1208): owner only, to someone in the crew. You
 * stay on as an admin; they become the one person nobody can demote.
 */
export function transferCrew(
	id: string,
	userId: string,
): Promise<ApiResult<RoomCrew>> {
	return api<RoomCrew>(`/api/crews/${id}/transfer`, {
		method: 'POST',
		json: { userId },
	});
}

/**
 * Open a room to the crew or shut it, by id (#1226) — the one permission a
 * crew admin holds over a room they never joined, and the row they hold
 * carries no slug (#1205).
 */
export function setRoomAccess(
	crewId: string,
	roomId: string,
	crewVisible: boolean,
	/** With the door, the listing to restore (#1929) — the undo of a shut. */
	listed?: boolean,
): Promise<ApiResult<void>> {
	return api<void>(`/api/crews/${crewId}/rooms/${roomId}/access`, {
		method: 'PATCH',
		json: listed === undefined ? { crewVisible } : { crewVisible, listed },
	});
}

/** What a share link shows before the join (#1236): the name, and how many. */
export interface CrewDoor {
	name: string;
	icon?: string;
	imageUrl?: string;
	members: number;
	/** Set only for someone already in the crew: the way in is the page. */
	inCrew?: boolean;
	id?: string;
	/** The crew removed you: no Join, the code will not get you back. */
	banned?: boolean;
}

export function crewDoor(
	code: string,
	fetcher: typeof fetch = fetch,
): Promise<ApiResult<CrewDoor>> {
	return loadApi<CrewDoor>(
		fetcher,
		`/api/crew-doors/${encodeURIComponent(code)}`,
	);
}

/** The one way in (ADR-0038 amended, #1236): the crew, by its code. */
export function joinCrew(code: string): Promise<ApiResult<RoomCrew>> {
	return api<RoomCrew>('/api/crews/join', { method: 'POST', json: { code } });
}

/** Out of the crew and every one of its rooms, in one move (#1228, #1236). */
export function leaveCrew(id: string): Promise<ApiResult<void>> {
	return api<void>(`/api/crews/${id}/leave`, { method: 'POST' });
}

/** The share link a code becomes. */
export function inviteLink(code: string): string {
	return `${location.origin}/c/${code}`;
}

/** The crew's picture (#1237): owner and admins; the same reader as a pasted image. */
export function setCrewImage(
	id: string,
	image: Blob,
): Promise<ApiResult<{ imageUrl: string }>> {
	return api<{ imageUrl: string }>(`/api/crews/${id}/image`, {
		method: 'POST',
		body: image,
		headers: { 'content-type': image.type },
	});
}

export function clearCrewImage(id: string): Promise<ApiResult<void>> {
	return api<void>(`/api/crews/${id}/image`, { method: 'DELETE' });
}
