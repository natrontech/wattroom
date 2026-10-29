// Your channel-mates on a free ride's road (#3117, ADR-0059), or the other
// racers on a race's (#3778): each at their own metre, moved by their own
// watts on their own screen, never by this one, and never in a bunch. It
// draws nothing: crew.ts does.
import type { RoadMate } from '$lib/channel/road-mates';
import type { Route } from '$lib/road/route';
import { LANE } from './bunch';
import { KEEP_RIGHT } from './crew';
import { MOST_ABREAST } from './lanes';
import { bunchLooks, type Loadout } from './loadout';
import { followMetre, simRider, type SimRider } from './sim';

/**
 * Carries the mates between ticks, one frame at a time: each rolls on at
 * their own speed and eases onto each new metre, as your figure does on the
 * ride's. You keep the right of the road; they ride beside you, a lane each
 * in the order the tick lists them, so they hold their lanes. One riding the
 * other way keeps the right of theirs.
 */
export function createAlongside(route?: Route) {
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
				mates.set(p.id, (mate = { r, follow: followMetre(route) }));
			}
			// Their way is what they said; the speed read off their metres is signed.
			mate.follow(
				mate.r,
				{ m: p.m, mps: Math.abs(p.mps), reverse: !!p.reverse },
				real,
			);
			Object.assign(mate.r, {
				name: p.name,
				watts: p.watts,
				ftp: p.ftp,
				speaking: p.speaking,
				faded: !!p.faded,
				// Their numbers are the channel's on a free ride and in a race
				// (ADR-0059); a faded racer's are gone with their screen.
				ring: !p.faded,
				// Beside you the way you ride; the other way, in their own half of
				// the road, where two lanes fit right of its middle (#4261).
				lane:
					!!p.reverse === !!you.reverse
						? KEEP_RIGHT + LANE * (1 + (i % 3))
						: KEEP_RIGHT + LANE * (i % 2),
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
