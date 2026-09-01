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
}

/**
 * The rail's room list with live presence — one fetch shape for the app
 * shell and the in-room rail (consolidated when the shell landed).
 */
export async function fetchRailRooms(): Promise<RailRoom[]> {
	const res = await api<{ rooms: RoomEntry[] }>('/api/rooms');
	if (!res.ok) return [];
	return res.data.rooms.map((room) => ({
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
		role: room.role,
	}));
}
