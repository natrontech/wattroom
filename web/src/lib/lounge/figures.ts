/**
 * Who the lounge seats and who it puts on a trainer, from the channel's
 * riders: everyone riding on a trainer, four on the sofa, the rest on
 * cushions around the rug, nearest the table first. Shirts are the jersey the world would seed for
 * the rider, so a crewmate wears the same colour on the sofa as on the road.
 */
import type { LiveRider } from '$lib/channel/types';
import { CUSHIONS, HAIRS, LOUNGE, SKINS, shadeOf } from '$lib/lounge/palette';
import { dyed, lookOf } from '$lib/lounge/look';
import {
	BIKES_ALWAYS,
	BIKE_DY,
	BIKE_GROUND,
	BIKE_XS,
	FRONT_Y,
	SCENE_W,
	SEATS,
	hasFront,
	SPOT_DX,
	SPOT_DY,
	middleOf,
	type Bike,
	type Crew,
	type Figure,
	type Rider,
	type Spot,
} from '$lib/lounge/scene';
import { fnv, hexOf, seededLoadout } from '$lib/world/loadout';

/**
 * A rider as the lounge draws them: the look they put together (look.ts), or
 * the one seeded from their id. A top left at its default is the jersey the
 * road would seed them.
 */
// ponytail: the road's seeded jersey only, not the outfit a Look hash fetches.
export function dress(
	r: Pick<LiveRider, 'id' | 'name' | 'loungeLook'> & Partial<LiveRider>,
): Figure {
	const seed = fnv(r.id);
	const look = lookOf(r.id, r.loungeLook);
	const skin = SKINS[look.skin];
	const jersey =
		hexOf.get(String(seededLoadout(r.id).colours?.jerseyA)) ?? LOUNGE.shirt;
	const shirt = dyed(look.topColour, jersey);
	const pants = dyed(look.trousers, LOUNGE.pants);
	return {
		id: r.id,
		name: r.name,
		skin,
		skinShade: shadeOf(skin),
		hair: HAIRS[look.hairColour],
		hairStyle: look.hair,
		shirt,
		shirtShade: shadeOf(shirt),
		top: look.top,
		stripes: look.stripes > 0,
		pants,
		pantsShade: look.trousers ? shadeOf(pants) : LOUNGE.pantsDark,
		shoes: dyed(look.shoes, LOUNGE.ink),
		glasses: look.glasses,
		cap: look.cap ? dyed(look.cap, '') : undefined,
		scarf: look.scarf ? dyed(look.scarf, '') : undefined,
		cushion: LOUNGE[CUSHIONS[(seed >>> 16) % CUSHIONS.length]],
		speaking: !!r.speaking,
		muted: !!r.muted,
		away: r.away ? (r.awayReason ?? '') : undefined,
		sounding: !!r.sounding,
		faded: !!r.linkLost,
	};
}

/** In the call: the voice roster, or everyone while it has not arrived. */
const present = (riders: LiveRider[]) =>
	riders.some((r) => r.inVoice) ? riders.filter((r) => r.inVoice) : riders;

/** Everyone riding, you first: each gets a trainer. */
export function ridersOf(riders: LiveRider[], t: number): Rider[] {
	return present(riders)
		.filter((r) => r.riding && !r.away)
		.sort((a, b) => Number(!!b.you) - Number(!!a.you))
		.map((r) => ({
			...dress(r),
			watts: r.stale ? 0 : r.watts,
			crank: ((t * (r.cadence || 80)) / 60) * Math.PI * 2,
		}));
}

/** Everyone else in the call, in the channel's order. */
export function seatedOf(riders: LiveRider[], onBikes: Set<string>): Figure[] {
	return present(riders)
		.filter((r) => !onBikes.has(r.id))
		.map(dress);
}

/** Where the trainers stand in a room w × h: both sides of the rug, row under row. */
export function bikeSlots(w: number, h: number): Bike[] {
	const { oy } = middleOf(w, h);
	const slots: Bike[] = [];
	for (let y = BIKE_GROUND; y + oy + 8 <= h; y += BIKE_DY)
		for (const x of BIKE_XS) slots.push({ x, y, face: x > 160 ? -1 : 1 });
	return slots;
}

/** Where nobody may sit: in front of the sofa, at the table, on the bike. */
function blocked({ x, y }: Spot, front: boolean): boolean {
	if (y < 112 && x > 98 && x < 222) return true;
	if (y < 142 && Math.abs(x - 160) < 36) return true;
	if (BIKE_XS.some((b) => Math.abs(x - b) < 20)) return true;
	return front && y > FRONT_Y - 30 && y < FRONT_Y + 14;
}

/** How far a spot is from the table, wider than deep, as the rug is. */
const fromTable = ({ x, y }: Spot) => ((x - 160) / 1.6) ** 2 + (y - 128) ** 2;

let cached: { key: string; spots: Spot[] } | undefined;

/**
 * Every place on the floor of a room w × h, in the stage's coordinates,
 * nearest the table first: a staggered grid a name's height apart, inside
 * the room and clear of the furniture.
 */
export function floorSpots(w: number, h: number): Spot[] {
	const key = `${w}x${h}`;
	if (cached?.key === key) return cached.spots;
	const { ox, oy } = middleOf(w, h);
	const spots: Spot[] = [];
	for (let row = 0; 104 + row * SPOT_DY + oy <= h - 10; row++) {
		const y = 104 + row * SPOT_DY;
		for (
			let x = 160 + (row % 2) * (SPOT_DX / 2);
			x + ox <= w - 12;
			x += SPOT_DX
		)
			spots.push({ x, y });
		for (
			let x = 160 + (row % 2) * (SPOT_DX / 2) - SPOT_DX;
			x + ox >= 12;
			x -= SPOT_DX
		)
			spots.push({ x, y });
	}
	const front = hasFront(w, h);
	const open = spots
		.filter((p) => !blocked(p, front))
		.sort((a, b) => fromTable(a) - fromTable(b));
	cached = { key, spots: open };
	return open;
}

/**
 * Everyone in the call, placed: each rider on a trainer, four on the sofa,
 * the rest round the rug. Anyone past the last spot is counted, not drawn.
 */
export function crewOf(
	riders: LiveRider[],
	t: number,
	w: number,
	h: number,
): Crew {
	const slots = bikeSlots(Math.max(SCENE_W, w), h);
	const onBikes = ridersOf(riders, t).slice(0, slots.length);
	const bikes = slots
		.slice(0, Math.max(BIKES_ALWAYS, onBikes.length))
		.map((slot, i) => ({ ...slot, rider: onBikes[i] }));
	const rest = seatedOf(riders, new Set(onBikes.map((r) => r.id)));
	const spots = floorSpots(Math.max(SCENE_W, w), h);
	return {
		bikes,
		seated: rest.slice(0, SEATS),
		floor: rest
			.slice(SEATS, SEATS + spots.length)
			.map((f, i) => ({ f, ...spots[i] })),
		more: Math.max(0, rest.length - SEATS - spots.length),
	};
}
