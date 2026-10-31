/**
 * Who the lounge seats and who it puts on the bike, from the channel's riders.
 * Shirts are the jersey the world would seed for the rider, so a crewmate
 * wears the same colour on the sofa as on the road.
 */
import type { LiveRider } from '$lib/channel/types';
import { HAIRS, SKINS } from '$lib/lounge/palette';
import type { Figure, Rider } from '$lib/lounge/scene';
import { fnv, hexOf, seededLoadout } from '$lib/world/loadout';

// ponytail: the seeded look only. A rider's chosen Look (ADR-0073) needs the
// outfit fetched by its hash; dress the lounge from it when the sofa shows outfits.
function dress(r: LiveRider): Figure {
	const seed = fnv(r.id);
	const look = seededLoadout(r.id);
	return {
		id: r.id,
		name: r.name,
		skin: SKINS[seed % SKINS.length],
		hair: HAIRS[(seed >>> 8) % HAIRS.length],
		shirt: hexOf.get(String(look.colours?.jerseyA)) ?? '#8b6cff',
		speaking: r.speaking,
		away: r.away ? (r.awayReason ?? '') : undefined,
	};
}

/** In the call: the voice roster, or everyone while it has not arrived. */
const present = (riders: LiveRider[]) =>
	riders.some((r) => r.inVoice) ? riders.filter((r) => r.inVoice) : riders;

/** The one on the bike: you when you ride, else the first rider who pedals. */
export function riderOf(riders: LiveRider[], crank: number): Rider | undefined {
	const on =
		riders.find((r) => r.riding && r.you && !r.away) ??
		riders.find((r) => r.riding && !r.away);
	return on && { ...dress(on), watts: on.stale ? 0 : on.watts, crank };
}

/** Everyone else in the call, on the sofa in the channel's order. */
export function seatedOf(riders: LiveRider[], onBike?: string): Figure[] {
	return present(riders)
		.filter((r) => r.id !== onBike)
		.map(dress);
}
