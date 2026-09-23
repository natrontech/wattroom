import { api, loadApi, type ApiResult } from '$lib/api';
import type { SessionRecap } from '$lib/protocol';
import type {
	BoardRow,
	RiderPrefs,
	RoomAccess,
	RoomCrew,
	Together,
} from '$lib/room/room-data';

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
	/** Medals the crew's sessions awarded them — on the Members read only (#2442). */
	medals?: number;
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
	/** Owner and admins only: in the public directory (ADR-0039 amended). */
	listed?: boolean;
	/** The crew keeps a weekly board (ADR-0036 as amended by ADR-0058). */
	boardEnabled?: boolean;
	/** The reaction palette its voice channels speak — icon keys. */
	cheers?: string[];
	/** The crew's calendar feed token (#2441): every member's, for sharing. */
	icsToken?: string;
}

export function fetchCrew(
	id: string,
	fetcher: typeof fetch = fetch,
): Promise<ApiResult<Crew>> {
	return loadApi<Crew>(fetcher, `/api/crews/${id}`);
}

/**
 * Crew Settings' one write, owner or admin: the name the day-one screen
 * exists for (#1151) rides every call, and each other field is left as it is
 * when absent. `cheers: []` is the base set.
 */
export function updateCrew(
	id: string,
	patch: {
		name: string;
		icon?: string;
		boardEnabled?: boolean;
		listed?: boolean;
		cheers?: string[];
	},
): Promise<ApiResult<RoomCrew>> {
	return api<RoomCrew>(`/api/crews/${id}`, { method: 'PATCH', json: patch });
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

/** What a share link shows before the join (#1236): the crew's name and mark,
 *  and nothing a stranger holding the code has no business learning — the
 *  headcount included (#1399). */
export interface CrewDoor {
	name: string;
	icon?: string;
	imageUrl?: string;
	/** Set only for someone already in the crew: the way in is the page. */
	inCrew?: boolean;
	id?: string;
	/** A member's to know, and only then (#1399): the roster shows it anyway. */
	members?: number;
	/** The crew removed you: no Join, the code will not get you back. */
	banned?: boolean;
	/** A signed-in stranger holding the code: the invite is theirs to keep,
	 *  and `rememberCrewDoor` is what keeps it (#2144, #2248). */
	invited?: boolean;
	/** The crew keeps a weekly board (ADR-0036 as amended by ADR-0058). */
	boardEnabled?: boolean;
}

/**
 * What the crew's door says before the join (#2456). ADR-0036 wants a board
 * "turned on ... visibly", before anyone is inside: joining is the moment
 * that publishes a rider's week to the crew, and a ride is private by
 * default. The copy lives here, not in the markup, because it is a privacy
 * disclosure an ADR requires — the reasoning the room's door gave, before
 * this replaced it.
 *
 * No door-time choice (ux.md, the 95% rule): the opt-out is the crew's
 * `on_board` switch on the other side, so the line names it.
 */
export function crewDoorDisclosure(door: { boardEnabled?: boolean }): {
	board?: string;
	privacy: string;
} {
	const watts =
		'Your watts are visible to the session you ride in, while you ride, and nowhere else.';
	return door.boardEnabled
		? {
				board:
					"This crew keeps a weekly board: your kJ and time are ranked beside everyone else's in your category, and it starts fresh every Monday. You can take yourself off it once you are in.",
				privacy: watts,
			}
		: // "Shows nobody your numbers" is true only of a crew with no board.
			{ privacy: `Joining shows nobody your numbers. ${watts}` };
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

/** Keep this door's invite on the account (#2144), so a sign-up that finishes
 *  in another tab still lands on the crew. Its own call because the door's
 *  read must not write: a GET carries no Origin check, so any page could have
 *  set a rider's pending invite by linking them at it (#2248). */
export function rememberCrewDoor(code: string): Promise<ApiResult<void>> {
	return api<void>(`/api/crew-doors/${encodeURIComponent(code)}/remember`, {
		method: 'POST',
	});
}

/** The one way in (ADR-0038 amended, #1236): the crew, by its code. */
export function joinCrew(code: string): Promise<ApiResult<RoomCrew>> {
	return api<RoomCrew>('/api/crews/join', { method: 'POST', json: { code } });
}

/**
 * A crew of your own (#2480): you own it, and it opens with a text and a voice
 * channel. Refused past docs/SPEC.md's founding cap.
 */
export function foundCrew(name: string): Promise<ApiResult<RoomCrew>> {
	return api<RoomCrew>('/api/crews', { method: 'POST', json: { name } });
}

/** A new invite (#1930): the old code and every link carrying it stop working. */
export function rotateCrewCode(
	id: string,
): Promise<ApiResult<{ code: string }>> {
	return api<{ code: string }>(`/api/crews/${id}/code`, { method: 'POST' });
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

/**
 * What the crew shows about its members (#2442, ADR-0036 as amended by
 * ADR-0058): the roster with medals, the bans for its owner and admins, your
 * own switches, the crew streak, its sessions against its own last month, and
 * the weekly board while the crew keeps one.
 */
export interface CrewMembers {
	members: CrewPerson[];
	banned?: CrewPerson[];
	me: RiderPrefs;
	/** UTC weeks with a session in any voice channel; pays nothing. */
	streakWeeks: number;
	together?: Together;
	boardEnabled: boolean;
	board?: BoardRow[];
}

export function fetchCrewMembers(
	id: string,
	fetcher: typeof fetch = fetch,
): Promise<ApiResult<CrewMembers>> {
	return loadApi<CrewMembers>(fetcher, `/api/crews/${id}/members`);
}

/** Sessions of the last 90 days in channels you may enter (docs/SPEC.md). */
export function fetchCrewRecaps(
	id: string,
	fetcher: typeof fetch = fetch,
): Promise<ApiResult<{ recaps: SessionRecap[] }>> {
	return loadApi<{ recaps: SessionRecap[] }>(
		fetcher,
		`/api/crews/${id}/recaps`,
	);
}
