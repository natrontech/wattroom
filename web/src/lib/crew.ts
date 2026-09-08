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
	avatarPreset?: string;
	role: CrewRole | 'banned';
	/** First joined any of the crew's rooms — or, on the ban list, banned on. */
	since: string;
	/** How many of the crew's rooms hold them; absent on the ban list. */
	rooms?: number;
}

export interface CrewRoom {
	slug: string;
	name: string;
	icon?: string;
	access: RoomAccess;
}

export interface Crew {
	id: string;
	name: string;
	icon?: string;
	/** What YOU are to it. */
	role: CrewRole;
	ownerId: string;
	rooms: CrewRoom[];
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
