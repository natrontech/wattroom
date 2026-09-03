import { api } from '$lib/api';
import type { RoomPresence } from '$lib/protocol';
import type { RailRoom } from '$lib/room/mockcompat';

interface RoomEntry extends RoomPresence {
	slug: string;
	name: string;
	icon?: string;
	memberCount?: number;
	unread?: number;
	role?: string;
	nextSession?: { workoutName: string; startsAt: string };
	lastChat?: RailRoom['lastChat'];
	cheers?: string[];
}

/** The rail's rooms, and the ownership cap they are counted against. */
export interface RailRoomList {
	rooms: RailRoom[];
	/** docs/SPEC.md's owned-room cap, as the server enforces it; 0 = unknown. */
	maxOwned: number;
}

/**
 * The rail's room list with live presence — one fetch shape for the app
 * shell and the in-room rail (consolidated when the shell landed).
 */
export async function fetchRailRooms(): Promise<RailRoomList> {
	const res = await api<{ rooms: RoomEntry[]; maxOwned?: number }>(
		'/api/rooms',
	);
	if (!res.ok) return { rooms: [], maxOwned: 0 };
	const rooms = res.data.rooms.map((room) => ({
		name: room.name,
		icon: room.icon,
		slug: room.slug,
		live: room.phase === 'running' || room.phase === 'countdown',
		members: room.memberCount ?? 0,
		connected: room.connected ?? 0,
		riders: room.riders ?? [],
		voice: room.voice ?? [],
		cameras: room.cameras ?? [],
		riding: room.riding ?? [],
		session: room.workoutName
			? { workoutName: room.workoutName, elapsedSec: room.elapsedSec ?? 0 }
			: undefined,
		next: room.nextSession,
		unread: room.unread ?? 0,
		lastChat: room.lastChat,
		cheers: room.cheers,
		role: room.role,
	}));
	return { rooms, maxOwned: res.data.maxOwned ?? 0 };
}
