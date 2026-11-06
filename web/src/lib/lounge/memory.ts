/**
 * What the crew's room remembers (GET /api/crews/{id}/room and its recaps):
 * medals on the wall, a polaroid of each of the last sessions on the
 * corkboard, and a plant that grows with every session ridden together.
 * Counts only: nothing here names a rider or a number from a ride.
 */
import { api } from '$lib/api';
import type { SessionRecap } from '$lib/protocol';
import type { ShopItem } from '$lib/lounge/furnish';

export interface RoomMemory {
	/** Sessions the crew has ridden together. */
	sessions: number;
	medals: number;
	/** How many rode each of the last sessions, newest first. */
	polaroids: number[];
	/** What the crew has furnished with, what is up, and the price list. */
	owned: string[];
	picks: Record<string, string>;
	shop: Record<string, ShopItem>;
	/** The arcade's best score. */
	hiscore: number;
}

export const NO_MEMORY: RoomMemory = {
	sessions: 0,
	medals: 0,
	polaroids: [],
	owned: [],
	picks: {},
	shop: {},
	hiscore: 0,
};

/** A room forgets nothing it was told, but draws only this many polaroids. */
const POLAROIDS = 3;

/** Sessions together at which the plant grows a size. */
const PLANT_SIZES = [1, 5, 20, 50];

/** How far the plant has grown: 0 for a new crew, 4 for an old one. */
export const plantStage = (sessions: number): number =>
	PLANT_SIZES.filter((at) => sessions >= at).length;

export async function fetchRoomMemory(crew: string): Promise<RoomMemory> {
	const [room, past, arcade] = await Promise.all([
		api<Omit<RoomMemory, 'polaroids' | 'hiscore'>>(`/api/crews/${crew}/room`),
		api<{ recaps: SessionRecap[] }>(`/api/crews/${crew}/recaps`),
		api<{ top: { score: number }[] }>(`/api/crews/${crew}/arcade`),
	]);
	if (!room.ok) return NO_MEMORY;
	return {
		...room.data,
		hiscore: arcade.ok ? (arcade.data.top[0]?.score ?? 0) : 0,
		polaroids: past.ok
			? past.data.recaps
					.slice(-POLAROIDS)
					.reverse()
					.map((recap) => recap.riders.length)
			: [],
	};
}
