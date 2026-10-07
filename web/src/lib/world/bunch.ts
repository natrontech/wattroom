// The bunch in the world (#3098, ADR-0065): who rides where. The hub sends
// one position a second, each joined rider's elastic offset from it, who
// rests and the order they joined in; this lays them out in formation and
// carries them between ticks. Every screen reads the same tick and the same
// clock, so every screen draws one bunch. It draws nothing: crew.ts does.
import type { BunchView } from '$lib/channel/bunch-view';
import { damp } from '$lib/motion/damp';
import { rigFor } from './figure/rig';
import { resolveKit } from './figure/kit';
import { ROAD_W } from './terrain/road-profile';

/** Metres between riders abreast. */
export const LANE = 0.9;
/** A bike, wheel to wheel, and docs/SPEC.md "Drafting"'s 1.0 m wheel gap: one row of the bunch. */
const BIKE = rigFor(resolveKit()).bk;
const ROW_M = BIKE.wheelbase + 2 * BIKE.R + 1.0;
/** Where a resting rider pulls over: the right shoulder, as on a Swiss road. */
export const PULL_LANE = -(ROAD_W / 2 - 0.5);
/** Where a rider a game put out stands (#3114): on the right verge, clear of the road. */
export const VERGE_LANE = -(ROAD_W / 2 + 1);
/** docs/SPEC.md "Riding a road together": the front row rotates every 120 s of elapsed time. */
const ROTATE_S = 120;
/** … the team car tows a rider back in over 20 s. */
const TOW_S = 20;
/** #3098: a rider more than 25 m from their place dithers out (200 ms) and back in (300 ms) there. */
const SNAP_M = 25;
const OUT_S = 0.2;
const IN_S = 0.3;
/** docs/SPEC.md "Riding a road together": a smaller error eases away over 5 s — a half-life of 1 s leaves 3 %. */
const EASE_HALF_S = 1;
/** #3098: lanes follow a critically damped spring with a 0.6 s half-life. */
const LANE_HALF_S = 0.6;
/** A car length, and a row's gap, behind the last row: where the team car follows. */
const CAR_BACK_M = 4.5 + ROW_M;
/** The car beside the rider it tows, centre to centre. */
const CAR_SIDE_M = 1.4;

/** docs/SPEC.md "Drafting": 3, 4 or 5 lanes for up to 6, 12 or more riders. */
export function lanesFor(n: number): number {
	return n <= 6 ? 3 : n <= 12 ? 4 : 5;
}

/** Where a rider sits in the bunch: metres left of the road's middle, and metres ahead of its centre. */
export type Slot = { lane: number; ahead: number };

/**
 * The formation (#3098): the riders in `order`, row by row from the front,
 * each row centred on the road; every 120 s of `elapsed` the front row drops
 * to the back and the rest move up. Centred on the bunch's metre, so a bunch
 * of one row rides where the hub says it is.
 */
export function formation(order: string[], elapsed: number): Map<string, Slot> {
	const out = new Map<string, Slot>();
	const n = order.length;
	const lanes = lanesFor(n);
	const rows = Math.ceil(n / lanes);
	const turn = Math.floor(Math.max(0, elapsed) / ROTATE_S) % Math.max(1, rows);
	order.forEach((id, i) => {
		const from = Math.floor(i / lanes);
		const abreast = Math.min(lanes, n - from * lanes);
		const row = (from - turn + rows) % rows;
		out.set(id, {
			lane: ((abreast - 1) / 2 - (i % lanes)) * LANE,
			ahead: ((rows - 1) / 2 - row) * ROW_M,
		});
	});
	return out;
}

/** A critically damped spring toward `to`, stepped `dt` seconds. */
function spring(s: { x: number; v: number }, to: number, dt: number) {
	const y = (2 * Math.LN2) / LANE_HALF_S;
	const j0 = s.x - to;
	const j1 = s.v + j0 * y;
	const e = Math.exp(-y * dt);
	s.x = e * (j0 + j1 * dt) + to;
	s.v = e * (s.v - j1 * y * dt);
}

/** One rider as the world draws them: where, how seen, and what they wear over it. */
export type Placed = {
	id: string;
	/** Metres along the road, a looped road's laps unrolled. */
	d: number;
	v: number;
	lane: number;
	/** 0 to 1: below 1 the figure is dithered. */
	alpha: number;
	resting: boolean;
	faded: boolean;
	coach: boolean;
	watts: number;
	ftp: number;
};

/** The team car: where, and how seen. */
export type Car = { d: number; lane: number; alpha: number; coach: boolean };

type Follow = Placed & {
	/** The rider's metre without their slot, carried at the bunch's speed between ticks. */
	base: number;
	/** Where the last frame's tick put them, without their slot. */
	target: number;
	side: { x: number; v: number };
	/** The lane the rider is making for this frame. */
	want: number;
	/** Their formation lane while they ride in it; none resting, towed or gone. */
	slot?: number;
	front: { x: number; v: number };
	/** Dithering out to land at `base` once gone, or in, or neither. */
	fade: 'out' | 'in' | null;
	gone: boolean;
	towUntil: number;
};

/**
 * Carries the bunch between ticks, one frame at a time: each rider rolls on
 * at the bunch's speed — dead reckoning, however long the ticks stay away —
 * eases onto the place each tick gives them, and dithers there when it is
 * too far to ease. Reads the tick and writes nothing back.
 */
export function createBunch() {
	const riders = new Map<string, Follow>();
	const car = { d: 0, lane: 0, alpha: 0, coach: false, on: false };
	let lastM = NaN;
	let since = 0;
	let t = 0;
	let first = true;
	// The least a tick has been late here: the network and the two clocks.
	let early = Infinity;

	/**
	 * `now` is the wall clock in ms, what a tick's `at` is read against.
	 * `stands` are the riders a game has put out (#3114), each stopped on the
	 * verge where they stand, metres along the road.
	 */
	function step(
		view: BunchView,
		real: number,
		now = NaN,
		stands?: ReadonlyMap<string, number>,
	): { riders: Placed[]; car: Car | null } {
		t += real;
		if (view.m !== lastM) {
			lastM = view.m;
			// A tick handled late — a busy page working through a backlog — is
			// already that late: the bunch rolled on from when the hub sent it.
			const late = now - (view.at ?? NaN);
			early = Math.min(early, late);
			since = Number.isFinite(late) ? (late - early) / 1000 : 0;
		} else since += real;
		const at = view.m + view.mps * since;
		const resting = new Set(view.resting);
		// A coach with no trainer is silent, so rests: they drive the team car instead (#3098).
		const driver =
			view.coach && resting.has(view.coach) && view.order.includes(view.coach)
				? view.coach
				: undefined;
		const riding = view.order.filter((id) => id !== driver);
		const slots = formation(
			riding.filter((id) => !resting.has(id)),
			view.elapsed,
		);
		for (const id of riding) {
			const target = at + (view.offsets[id] ?? 0);
			let f = riders.get(id);
			if (!f) {
				// A rider already there when this screen first looks is simply there; a late joiner dithers in.
				f = {
					id,
					d: target,
					v: view.mps,
					lane: 0,
					alpha: first ? 1 : 0,
					resting: false,
					faded: false,
					coach: false,
					watts: 0,
					ftp: 0,
					base: target,
					target,
					side: { x: slots.get(id)?.lane ?? PULL_LANE, v: 0 },
					want: slots.get(id)?.lane ?? PULL_LANE,
					front: { x: slots.get(id)?.ahead ?? 0, v: 0 },
					fade: first ? null : 'in',
					gone: false,
					towUntil: -Infinity,
				};
				riders.set(id, f);
			}
			const stand = stands?.get(id);
			if (stand !== undefined) {
				atRoadside(f, stand, real);
				continue;
			}
			if (f.resting && !resting.has(id) && !view.game) f.towUntil = t + TOW_S;
			f.resting = resting.has(id);
			const there = view.present.get(id);
			f.faded = !there;
			f.watts = there?.watts ?? 0;
			f.ftp = there?.ftp ?? 0;
			f.coach = id === view.coach;
			f.gone = false;
			f.v = view.mps;
			// What the rider still owed their place eases away over this frame; what
			// a tick moved it by in this frame starts owing now. However long the
			// frames, every screen lands on the same metre at the same moment.
			const owed =
				(f.base - f.target) * (1 - damp(EASE_HALF_S, real)) -
				(target - f.target - view.mps * real);
			f.target = target;
			f.base = target + owed;
			if (f.fade === null && Math.abs(owed) > SNAP_M) f.fade = 'out';
			dither(f, real, () => (f.base = target));
			f.slot = f.resting || f.towUntil > t ? undefined : slots.get(id)?.lane;
			f.want = f.slot ?? PULL_LANE;
			spring(f.front, slots.get(id)?.ahead ?? 0, real);
			f.d = f.base + f.front.x;
		}
		first = false;
		// Gone from the bunch: dithered out where they were, then let go.
		for (const f of riders.values()) {
			if (riding.includes(f.id)) continue;
			f.gone = true;
			f.slot = undefined;
			f.base += f.v * real;
			f.d = f.base + f.front.x;
			f.alpha -= real / OUT_S;
			if (f.alpha <= 0) riders.delete(f.id);
		}
		giveWay([...riders.values()]);
		for (const f of riders.values()) {
			spring(f.side, f.want, real);
			f.lane = f.side.x;
		}
		return {
			riders: [...riders.values()],
			car: teamCar(view, at, slots, driver, real),
		};
	}

	/** Out of the game, at the roadside (#3114): stopped on the verge at their stand, dithered there from wherever they were. */
	function atRoadside(f: Follow, stand: number, real: number) {
		f.v = 0;
		f.target = stand;
		f.slot = undefined;
		f.want = VERGE_LANE;
		if (f.fade === null && f.base !== stand) f.fade = 'out';
		dither(f, real, () => {
			f.base = stand;
			f.side = { x: VERGE_LANE, v: 0 };
			f.front = { x: 0, v: 0 };
		});
		f.d = f.base + f.front.x;
	}

	/** The car tows whoever is towed, else follows the bunch with its driver, else is gone (#3098). */
	function teamCar(
		view: BunchView,
		at: number,
		slots: Map<string, Slot>,
		driver: string | undefined,
		real: number,
	): Car | null {
		const towed = [...riders.values()].find((f) => f.towUntil > t && !f.gone);
		const want = !view.game && (!!towed || !!driver);
		if (want) {
			let back = 0;
			for (const s of slots.values()) back = Math.min(back, s.ahead);
			const d = towed ? towed.d : at + back - CAR_BACK_M;
			const lane = towed ? towed.lane + CAR_SIDE_M : 0;
			if (!car.on) Object.assign(car, { d, lane, alpha: 0, on: true });
			// A tow ends on a rider already in the bunch: the car pulls aside and drops back.
			car.d += view.mps * real + (d - car.d) * damp(LANE_HALF_S, real);
			car.lane += (lane - car.lane) * damp(LANE_HALF_S, real);
			car.alpha = Math.min(1, car.alpha + real / IN_S);
			car.coach = !!driver;
		} else if (car.on) {
			car.d += view.mps * real;
			car.alpha -= real / OUT_S;
			if (car.alpha <= 0) car.on = false;
		}
		return car.on
			? { d: car.d, lane: car.lane, alpha: car.alpha, coach: car.coach }
			: null;
	}

	return { step };
}

/** Dithers a rider out, lands them where `land` says, and dithers them back in: never a slide through others. */
function dither(f: Follow, real: number, land: () => void) {
	if (f.fade === 'out') {
		f.alpha -= real / OUT_S;
		if (f.alpha <= 0) {
			f.alpha = 0;
			land();
			f.fade = 'in';
		}
	}
	if (f.fade === 'in') {
		f.alpha = Math.min(1, f.alpha + real / IN_S);
		if (f.alpha === 1) f.fade = null;
	}
}

/**
 * Two riders whose slots share a lane within a bike of each other — a rider
 * moving up on their offset, or the front row dropping back — and the one
 * behind makes for the gap between that lane and the next, so nobody rides
 * through anybody. Read from the slots, never from where a lane's spring has
 * got to, so it holds the same on every screen whatever each saw before.
 * ponytail: pairwise, O(n²) over a bunch of tens; a sweep by d if bunches grow.
 */
function giveWay(riders: Follow[]) {
	const bike = ROW_M - 1.0;
	for (const a of riders)
		for (const b of riders)
			if (
				a !== b &&
				a.slot !== undefined &&
				b.slot !== undefined &&
				Math.abs(a.slot - b.slot) < LANE / 4 &&
				(a.d > b.d || (a.d === b.d && a.id < b.id)) &&
				a.d - b.d < bike
			)
				b.want = a.slot + LANE / 2;
}
