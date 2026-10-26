import {
	MaxRoadSpeedMps,
	type FreeRoadPlace,
	type ServerTick,
} from '$lib/protocol';
import type { LiveRider } from '$lib/channel/types';
import type { FreeRide } from '$lib/ride/free-ride.svelte';
import { racerHeld } from '$lib/channel/road-place';
import { JUMP_M } from '$lib/world/sim';

/** A channel-mate free-riding your road (#3117), as the world draws them. */
export type RoadMate = {
	id: string;
	name: string;
	/** Metres along the road, as their own samples count them. */
	m: number;
	/** Their speed along it, m/s: negative on a lap back down the road. */
	mps: number;
	/** On a lap back down the road, as they said it (#3205). */
	reverse?: boolean;
	watts: number;
	ftp: number;
	speaking: boolean;
	/** A racer whose screen has gone (#3778): drawn in greys, no zone ring (docs/spec/world.md). */
	faded?: boolean;
};

/** Nobody beside you: one empty list a frame loop can read every frame. */
export const NO_MATES: readonly RoadMate[] = [];

/** A place that has not moved this long is a rider who stopped. */
const STILL_MS = 2500;

/**
 * Your channel-mates on your road, tick by tick (#3117, ADR-0059). The hub
 * numbers each road two free riders here share and sends no other road, so
 * a mate is whoever the tick puts on your number. A sample carries no speed:
 * it is read off each mate's last two places. Never you.
 */
export function createRoadMates() {
	const last = new Map<string, { m: number; at: number; mps: number }>();
	return (
		tick: Pick<ServerTick, 'at' | 'freeRoads'> | null | undefined,
		riders: readonly LiveRider[],
		you: string,
	): RoadMate[] => {
		const places = tick?.freeRoads ?? {};
		const mine = places[you]?.road;
		const out: RoadMate[] = [];
		for (const [id, p] of Object.entries(places)) {
			if (id === you || mine === undefined || p.road !== mine) continue;
			const was = last.get(id);
			let mps = was?.mps ?? 0;
			if (!was || p.m !== was.m) {
				if (was && tick!.at > was.at) {
					const v = (p.m - was.m) / ((tick!.at - was.at) / 1000);
					mps = Math.max(-MaxRoadSpeedMps, Math.min(MaxRoadSpeedMps, v));
				}
				last.set(id, { m: p.m, at: tick!.at, mps });
			} else if (tick!.at - was.at > STILL_MS) mps = 0;
			const r = riders.find((x) => x.id === id);
			out.push({
				id,
				name: r?.name ?? '',
				m: p.m,
				mps,
				...(p.reverse && { reverse: true }),
				watts: r?.watts ?? 0,
				ftp: r?.ftp ?? 0,
				speaking: !!r?.speaking,
			});
		}
		for (const id of last.keys())
			if (!out.some((r) => r.id === id)) last.delete(id);
		return out;
	};
}

/**
 * The other racers on a race's road (#3778, ADR-0067), each at their own
 * metre and speed as the hub steps them: a race rides no bunch. A racer
 * whose screen has gone, off the roster or with their socket lost, stays on
 * the road where the hub holds them, faded.
 */
export function racersOnRoad(
	tick: Pick<ServerTick, 'at' | 'state' | 'world' | 'game'> | null | undefined,
	riders: readonly LiveRider[],
	you: string,
): RoadMate[] {
	const racers = tick?.world?.racers;
	if (!racers) return [];
	return Object.entries(racers).flatMap(([id, p]) => {
		if (id === you) return [];
		const r = riders.find((x) => x.id === id);
		return [
			{
				id,
				name: r?.name ?? '',
				m: p.m,
				mps: racerHeld(tick, p.m) ? 0 : p.v,
				watts: r?.watts ?? 0,
				ftp: r?.ftp ?? 0,
				speaking: !!r?.speaking,
				faded: !r || !!r.linkLost,
			},
		];
	});
}

/** Where mate `id` is on your road, as the tick says; null off it (#3117). */
export function mateOnRoad(
	tick: Pick<ServerTick, 'freeRoads'> | null | undefined,
	you: string,
	id: string,
): FreeRoadPlace | null {
	const mine = tick?.freeRoads?.[you];
	const theirs = tick?.freeRoads?.[id];
	return id !== you && mine && theirs?.road === mine.road ? theirs : null;
}

/**
 * "Ride with <name>" (#3117): one jump to a mate's metre, their way along
 * the road, then ride freely. Null while you ride together already: a mate
 * within JUMP_M, where your figure would ease to them rather than jump.
 */
export function rideWith(
	mate: Pick<FreeRoadPlace, 'm' | 'reverse'>,
	free: Pick<FreeRide, 'road' | 'rideWith'> | undefined,
): (() => void) | null {
	const here = free?.road;
	if (!free || !here || Math.abs(mate.m - here.m) <= JUMP_M) return null;
	return () => free.rideWith(mate.m, !!mate.reverse);
}
