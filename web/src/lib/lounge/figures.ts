/**
 * Who the lounge seats and who it puts on a trainer, from the channel's
 * riders: everyone riding on a trainer, four on the sofa, the rest on
 * cushions around the rug, nearest the table first. Shirts are the jersey the world would seed for
 * the rider, so a crewmate wears the same colour on the sofa as on the road.
 */
import type { LiveRider } from '$lib/channel/types';
import { CUSHIONS, HAIRS, LOUNGE, SKINS, shadeOf } from '$lib/lounge/palette';
import { dyed, lookOf } from '$lib/lounge/look';
import { hash3 } from '$lib/lounge/hash';
import {
	BIKES_ALWAYS,
	BIKE_DY,
	BIKE_GROUND,
	BIKE_XS,
	FRONT_Y,
	PLACES,
	SCENE_W,
	SEATS,
	hasFront,
	SPOT_DX,
	SPOT_DY,
	middleOf,
	type Bike,
	type Doing,
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
		socks: look.socks ? dyed(look.socks, '') : undefined,
		beard: look.beard,
		badge: look.badge,
		pet: look.pet,
		cushion: LOUNGE[CUSHIONS[(seed >>> 16) % CUSHIONS.length]],
		speaking: !!r.speaking,
		muted: !!r.muted,
		away: r.away ? (r.awayReason ?? '') : undefined,
		sounding: !!r.sounding,
		faded: !!r.linkLost,
		seat: r.seat,
		emote: r.emote,
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
			// In eighths of a turn, as sprites step: smooth legs on a pixel bike shimmer.
			crank: (Math.floor(((t * (r.cadence || 80)) / 60) * 8) / 8) * Math.PI * 2,
		}));
}

/** Everyone else in the call, in the channel's order. */
export function seatedOf(
	riders: LiveRider[],
	onBikes: Set<string>,
	cooling: ReadonlySet<string> = NOBODY,
): Figure[] {
	return present(riders)
		.filter((r) => !onBikes.has(r.id))
		.map((r) => ({ ...dress(r), cooling: cooling.has(r.id) }));
}

const NOBODY: ReadonlySet<string> = new Set();

/** How long someone keeps at one idle thing before the next. */
export const IDLE_SLOT_SEC = 50;

/**
 * What someone sitting about is up to: a function of who they are and the
 * server's clock, so every screen sees the same. Some of the time, nothing.
 */
export function idleOf(id: string, sec: number, music: boolean): Doing {
	const slot = Math.floor((sec + (fnv(id) % IDLE_SLOT_SEC)) / IDLE_SLOT_SEC);
	const pick = hash3(fnv(id), slot, 61);
	if (pick < 0.3) return '';
	const list: Doing[] = ['sip', 'read', 'phone', 'stretch', 'sip', 'nap'];
	if (music) list.push('nod', 'nod');
	return list[Math.floor(hash3(fnv(id), slot, 67) * list.length)];
}

/** How long a rider keeps the towel on after getting off the bike. */
export const COOLING_SEC = 600;

/**
 * Who just got off the bike. A pure step over the roster's riding flag, so
 * nothing about a ride but that it ended is known here; each screen starts
 * counting when it sees the ride end.
 */
export function cooled(
	riders: readonly { id: string; riding?: unknown }[],
	wasRiding: ReadonlySet<string>,
	until: ReadonlyMap<string, number>,
	clock: number,
): { riding: Set<string>; until: Map<string, number> } {
	const riding = new Set(riders.filter((r) => r.riding).map((r) => r.id));
	const next = new Map([...until].filter(([, end]) => end > clock));
	for (const id of wasRiding)
		if (!riding.has(id)) next.set(id, clock + COOLING_SEC);
	for (const id of riding) next.delete(id);
	return { riding, until: next };
}

/** Where the trainers stand in a room w × h: both sides of the rug, row under row. */
export function bikeSlots(w: number, h: number, cinema = false): Bike[] {
	const { oy } = middleOf(w, h, cinema);
	const slots: Bike[] = [];
	const front = hasFront(w, h, cinema);
	for (let y = BIKE_GROUND; y + oy + 8 <= h; y += BIKE_DY) {
		// The front row's furniture stands where a third row would.
		if (front && y > FRONT_Y - 44 && y < FRONT_Y + 24) continue;
		for (const x of BIKE_XS) slots.push({ x, y, face: x > 160 ? -1 : 1 });
	}
	return slots;
}

/** Where nobody may sit: in front of the sofa, at the table, on the bike. */
function blocked({ x, y }: Spot, front: boolean): boolean {
	if (y < 112 && x > 98 && x < 222) return true;
	if (y < 142 && Math.abs(x - 160) < 36) return true;
	if (BIKE_XS.some((b) => Math.abs(x - b) < 20)) return true;
	if (!front) return false;
	// The floor's crates, and the front row.
	if (y > 170 && y < 208 && (x < 66 || x > 262)) return true;
	return y > FRONT_Y - 30 && y < FRONT_Y + 24;
}

/** How far a spot is from the table, wider than deep, as the rug is. */
const fromTable = ({ x, y }: Spot) => ((x - 160) / 1.6) ** 2 + (y - 128) ** 2;

let cached: { key: string; spots: Spot[] } | undefined;

/**
 * Every place on the floor of a room w × h, in the stage's coordinates,
 * nearest the table first: a staggered grid a name's height apart, inside
 * the room and clear of the furniture.
 */
export function floorSpots(w: number, h: number, cinema = false): Spot[] {
	const key = `${w}x${h}:${cinema}`;
	if (cached?.key === key) return cached.spots;
	const { ox, oy } = middleOf(w, h, cinema);
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
	const front = hasFront(w, h, cinema);
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
	cooling: ReadonlySet<string> = NOBODY,
	now: { sec: number; music: boolean } = { sec: 0, music: false },
	cinema = false,
): Crew {
	const slots = bikeSlots(Math.max(SCENE_W, w), h, cinema);
	const onBikes = ridersOf(riders, t).slice(0, slots.length);
	const bikes = slots
		.slice(0, Math.max(BIKES_ALWAYS, onBikes.length))
		.map((slot, i) => ({ ...slot, rider: onBikes[i] }));
	const rest = seatedOf(riders, new Set(onBikes.map((r) => r.id)), cooling);
	const front = hasFront(Math.max(SCENE_W, w), h, cinema);
	const up = (f: Figure): Figure => ({
		...f,
		doing: f.speaking ? '' : idleOf(f.id, now.sec, now.music),
	});
	// Those who took a place first, first come first kept; the rest as it falls.
	const sofa: (Figure | null)[] = Array.from({ length: SEATS }, () => null);
	const placed: Crew['placed'] = [];
	const taken = new Set<number>();
	const others: Figure[] = [];
	for (const f of rest) {
		const seat = f.seat ?? 0;
		const place = PLACES.find((p) => p.seat === seat);
		if (seat >= 1 && seat <= SEATS && !sofa[seat - 1]) sofa[seat - 1] = up(f);
		else if (place && !taken.has(seat) && (!place.front || front)) {
			taken.add(seat);
			placed.push({ f: { ...f, doing: place.doing }, x: place.x, y: place.y });
		} else others.push(f);
	}
	for (let i = 0; i < SEATS && others.length; i++)
		if (!sofa[i]) sofa[i] = up(others.shift()!);
	while (sofa.length && !sofa[sofa.length - 1]) sofa.pop();
	const spots = floorSpots(Math.max(SCENE_W, w), h, cinema);
	return {
		bikes,
		seated: sofa,
		floor: others
			.slice(0, spots.length)
			.map((f, i) => ({ f: up(f), ...spots[i] })),
		placed,
		more: Math.max(0, others.length - spots.length),
	};
}
