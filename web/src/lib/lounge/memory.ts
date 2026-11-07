/**
 * What the crew's room remembers (GET /api/crews/{id}/room and its recaps):
 * medals on the wall, a polaroid of each of the last sessions on the
 * corkboard, and a plant that grows with every session ridden together.
 * Counts only: nothing here names a rider or a number from a ride.
 */
import { api } from '$lib/api';
import type { SessionRecap } from '$lib/protocol';
import type { ShopItem } from '$lib/lounge/furnish';
import type { ArcadeRecord } from '$lib/lounge/scene';

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
	/** Each game's record, and who holds one. */
	records: ArcadeRecord[];
	crowns: string[];
}

/** What GET /api/crews/{id}/arcade returns (crews/arcade.go). */
export interface ArcadeView {
	day: string;
	seed: number;
	games: Record<string, ArcadeBoard>;
	cup: { id: string; name: string; wins: number }[];
}

export interface ArcadeEntry {
	id: string;
	name: string;
	score: number;
}

export interface ArcadeBoard {
	top: ArcadeEntry[];
	today: ArcadeEntry[];
	best: number;
}

/** Three letters for the cabinet's screen, from the letters it has. */
export const initialsOf = (name: string): string =>
	name
		.normalize('NFD')
		.toUpperCase()
		.replace(/[^A-Z]/g, '')
		.slice(0, 3);

/** Each game's record holder, in the cabinet's order. */
export function recordsOf(view: ArcadeView, order: readonly string[]) {
	const holders = order
		.map((game) => view.games[game]?.top[0])
		.filter((e): e is ArcadeEntry => !!e && e.score > 0);
	return {
		records: holders.map((e) => ({
			initials: initialsOf(e.name),
			score: e.score,
		})),
		crowns: [...new Set(holders.map((e) => e.id))],
	};
}

export const NO_MEMORY: RoomMemory = {
	sessions: 0,
	medals: 0,
	polaroids: [],
	owned: [],
	picks: {},
	shop: {},
	records: [],
	crowns: [],
};

/** The cabinet's games in its order; games/index.ts holds how each plays. */
const ARCADE_ORDER = ['bergpreis', 'feedzone', 'darts'] as const;

/** A room forgets nothing it was told, but draws only this many polaroids. */
const POLAROIDS = 3;

/** Sessions together at which the plant grows a size. */
const PLANT_SIZES = [1, 5, 20, 50];

/** How far the plant has grown: 0 for a new crew, 4 for an old one. */
export const plantStage = (sessions: number): number =>
	PLANT_SIZES.filter((at) => sessions >= at).length;

export async function fetchRoomMemory(crew: string): Promise<RoomMemory> {
	const [room, past, arcade] = await Promise.all([
		api<Omit<RoomMemory, 'polaroids' | 'records' | 'crowns'>>(
			`/api/crews/${crew}/room`,
		),
		api<{ recaps: SessionRecap[] }>(`/api/crews/${crew}/recaps`),
		api<ArcadeView>(`/api/crews/${crew}/arcade`),
	]);
	if (!room.ok) return NO_MEMORY;
	return {
		...room.data,
		...(arcade.ok
			? recordsOf(arcade.data, ARCADE_ORDER)
			: { records: [], crowns: [] }),
		polaroids: past.ok
			? past.data.recaps
					.slice(-POLAROIDS)
					.reverse()
					.map((recap) => recap.riders.length)
			: [],
	};
}
