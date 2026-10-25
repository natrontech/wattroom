import { MaxRoadSpeedMps, type ServerTick } from '$lib/protocol';
import type { LiveRider } from '$lib/channel/types';

/** A channel-mate free-riding your road (#3117), as the world draws them. */
export type RoadMate = {
	id: string;
	name: string;
	/** Metres along the road, as their own samples count them. */
	m: number;
	/** Their speed along it, m/s: negative on a lap back down the road. */
	mps: number;
	watts: number;
	ftp: number;
	speaking: boolean;
};

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
