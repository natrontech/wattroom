import { api } from '$lib/api';
import type { RailRoom } from '$lib/room/mockcompat';

interface RoomEntry {
	slug: string;
	name: string;
	memberCount?: number;
	connected?: number;
	phase?: string;
	riders?: string[];
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
		slug: room.slug,
		live: room.phase === 'running' || room.phase === 'countdown',
		members: room.memberCount ?? 0,
		connected: room.connected ?? 0,
		riders: room.riders ?? [],
	}));
}
