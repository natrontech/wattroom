// Your channel-mates on a free ride's road (#3117, ADR-0059): each at their
// own metre, moved by their own watts on their own screen, never by this
// one, and never in a bunch or ranked. It draws nothing: crew.ts does.
import type { RoadMate } from '$lib/channel/road-mates';
import { LANE } from './bunch';
import { KEEP_RIGHT } from './crew';
import { MOST_ABREAST } from './lanes';
import { bunchLooks, type Loadout } from './loadout';
import { followMetre, simRider, type SimRider } from './sim';

/**
 * Carries the mates between ticks, one frame at a time: each rolls on at
 * their own speed and eases onto each new metre, as your figure does on the
 * ride's. You keep the right of the road; they ride beside you, a lane each
 * in the order the tick lists them, so they hold their lanes.
 */
export function createAlongside() {
	const mates = new Map<
		string,
		{ r: SimRider; follow: ReturnType<typeof followMetre> }
	>();
	let lookedAt = '';
	let looks = new Map<string, Loadout>();

	/** This frame's riders, you first; `you` is given your lane and look beside them. */
	function step(
		you: SimRider,
		list: readonly RoadMate[],
		real: number,
	): SimRider[] {
		const here = new Set<string>();
		list.forEach((p, i) => {
			here.add(p.id);
			let mate = mates.get(p.id);
			if (!mate) {
				const r = simRider({
					id: p.id,
					name: p.name,
					mass: 0,
					ftp: p.ftp,
					you: false,
					watts: p.watts,
					d: p.m,
				});
				mates.set(p.id, (mate = { r, follow: followMetre() }));
			}
			mate.follow(mate.r, { m: p.m, mps: p.mps }, real);
			Object.assign(mate.r, {
				name: p.name,
				watts: p.watts,
				ftp: p.ftp,
				speaking: p.speaking,
				// Their numbers are the channel's on a free ride (ADR-0059).
				ring: true,
				lane: KEEP_RIGHT + LANE * (1 + (i % 3)),
			});
		});
		for (const id of mates.keys()) if (!here.has(id)) mates.delete(id);
		const ridden = [you, ...[...mates.values()].map((m) => m.r)];
		// Dressed apart in id order, so every screen on the road dresses them
		// alike; alone, you wear the look your id seeds.
		const order = ridden.map((r) => r.id).sort();
		if (order.join(' ') !== lookedAt) {
			lookedAt = order.join(' ');
			looks = bunchLooks(
				order.map((id) => ({ id })),
				MOST_ABREAST,
			);
		}
		for (const r of ridden) r.look = mates.size ? looks.get(r.id) : undefined;
		you.lane = mates.size ? KEEP_RIGHT : undefined;
		return ridden;
	}

	return { step };
}
