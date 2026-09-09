import { api } from '$lib/api';
import type { RoomPresence } from '$lib/protocol';
import type { RailRoom } from '$lib/room/mockcompat';
import type { RoomAccess, RoomCrew } from '$lib/room/room-data';

interface RoomEntry extends RoomPresence {
	id?: string;
	/** Absent on a row you may not enter — the slug is the door (#1205). */
	slug?: string;
	name: string;
	icon?: string;
	memberCount?: number;
	unread?: number;
	role?: string;
	nextSession?: { workoutName: string; startsAt: string };
	lastChat?: RailRoom['lastChat'];
	cheers?: string[];
	crew?: RoomCrew;
	access?: RoomAccess;
}

/** The rail's rooms, and the ownership cap they are counted against. */
export interface RailRoomList {
	rooms: RailRoom[];
	/**
	 * Every crew you are in, rooms or none (#1476) — the room rows' crews
	 * are a subset. Empty against a server from before it existed.
	 */
	crews: RoomCrew[];
	/** docs/SPEC.md's owned-room cap, as the server enforces it; 0 = unknown. */
	maxOwned: number;
}

/**
 * The rail's room list with live presence — one fetch shape for the app
 * shell and the in-room rail (consolidated when the shell landed).
 */
export async function fetchRailRooms(): Promise<RailRoomList> {
	const res = await api<{
		rooms: RoomEntry[];
		crews?: RoomCrew[];
		maxOwned?: number;
	}>('/api/rooms');
	if (!res.ok) return { rooms: [], crews: [], maxOwned: 0 };
	const rooms = res.data.rooms.map((room) => ({
		name: room.name,
		icon: room.icon,
		id: room.id,
		// A slugless row keys by its id: never '' — an empty slug would read
		// as the room you are connected to when you are connected to none.
		slug: room.slug ?? room.id ?? '',
		live: room.phase === 'running' || room.phase === 'countdown',
		members: room.memberCount ?? 0,
		connected: room.connected ?? 0,
		riders: room.riders ?? [],
		riderIds: room.riderIds ?? [],
		voice: room.voice ?? [],
		cameras: room.cameras ?? [],
		riding: room.riding ?? [],
		ridingIds: room.ridingIds ?? [],
		session: room.workoutName
			? { workoutName: room.workoutName, elapsedSec: room.elapsedSec ?? 0 }
			: undefined,
		next: room.nextSession,
		unread: room.unread ?? 0,
		lastChat: room.lastChat,
		cheers: room.cheers,
		role: room.role,
		crew: room.crew,
		access: room.access,
	}));
	return {
		rooms,
		crews: res.data.crews ?? [],
		maxOwned: res.data.maxOwned ?? 0,
	};
}
