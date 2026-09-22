import { api } from '$lib/api';
import type { RailRoom, RoomCrew } from '$lib/room/room-data';

/** The rail's rooms, and the ownership cap they are counted against. */
export interface RailRoomList {
	rooms: RailRoom[];
	/** Every crew you are in (#1476). */
	crews: RoomCrew[];
	/** docs/SPEC.md's owned-room cap, as the server enforces it; 0 = unknown. */
	maxOwned: number;
	/** The server's message when the read failed — never an empty list in disguise. */
	error?: string;
}

/**
 * The shell's crews. The rooms are gone from the server (#2446), so the room
 * half of this list is always empty until #2460 takes its readers out.
 */
export async function fetchRailRooms(): Promise<RailRoomList> {
	const res = await api<{ crews: RoomCrew[] }>('/api/crews');
	if (!res.ok)
		return { rooms: [], crews: [], maxOwned: 0, error: res.error.message };
	return { rooms: [], crews: res.data.crews, maxOwned: 0 };
}
