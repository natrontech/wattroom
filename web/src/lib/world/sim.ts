// The ride: every rider is (distance along the route, speed). The world is
// drawn from that pair alone, which is also all a session would ever put
// on the wire per rider — one number more than today's tick.
import { PaceDefaultCdA } from '$lib/protocol';
import { createPace, type Pace } from '$lib/road/pace';
import { type Route } from '$lib/road/route';
import { at } from '$lib/road/along';
import { damp } from '$lib/motion/damp';
import type { CheerLook } from './cheer';

// What the trainer is told. Zwift's default "trainer difficulty" halves the
// grade so a 12 % ramp does not stall a rider on a direct-drive; descents
// are sent flat because a trainer cannot push the pedals.
// ponytail: the dev world's stand-in for rideGrade() (#3025).
function trainerGrade(routeGrade: number, difficulty = 0.5): number {
	return Math.max(0, routeGrade * difficulty);
}

export type SimRider = {
	id: string;
	name: string;
	mass: number;
	ftp: number;
	you: boolean;
	watts: number;
	d: number; // metres along the route
	v: number; // m/s
	lap: number;
	/** The shared pace model (#3048), stepped once a second. */
	pace: Pace;
	/** Where the last whole second left the rider, and how far into the next. */
	at: number;
	into: number;
	/** How a stand-in rides: its watts on this grade at this time. Only the dev gallery has them. */
	ride?: (r: SimRider, grade: number, t: number) => number;
	/** Metres left of the road's middle, from the bunch's formation (#3098); absent, crew.ts spreads riders abreast. */
	lane?: number;
	/** 0–1: below 1 the figure is dithered, arriving, leaving or landing somewhere new. */
	alpha?: number;
	/** Joined, but their screen has gone: drawn in greys. */
	faded?: boolean;
	/** The session's coach: wears the chevron. */
	coach?: boolean;
	/** Their live zone as a ring; false leaves anyone's but yours to #3086. */
	ring?: boolean;
	/** Their trainer has gone quiet past SIGNAL_LOST_MS (#3766): the ring drops its zone and the trail stops, as the panels' numbers read "—". */
	silent?: boolean;
	/** A cheer for them, as it looks this frame (#3116). */
	cheer?: CheerLook | null;
	/** At the roadside, put out by a game (#3114): stopped on the verge, legs still. */
	stopped?: boolean;
};

export type Env = { difficulty: number };

export function advance(
	route: Route,
	riders: SimRider[],
	dt: number,
	t: number,
): void {
	for (const r of riders) {
		// Whole seconds through the pace model, as a session steps it; the
		// frames between them extrapolate at the last second's speed. Six
		// frames of a sixth sum to 0.999…, so a second is whole a hair early.
		for (r.into += dt; r.into > 1 - 1e-9; r.into -= 1) {
			const g = at(route, r.at).grade;
			if (r.ride) r.watts = r.ride(r, g, t);
			const before = r.pace.distance;
			r.pace.step(r.watts, g, r.mass, PaceDefaultCdA, 0);
			r.at += r.pace.distance - before;
			if (!route.loop) r.at = Math.min(r.at, route.length);
		}
		r.v = r.pace.speed;
		r.d = r.at + r.v * r.into;
		if (route.loop && r.d >= route.length * (r.lap + 1)) r.lap++;
		if (!route.loop) r.d = Math.min(r.d, route.length);
	}
}

export function trainerFor(route: Route, r: SimRider, env: Env): number {
	return trainerGrade(at(route, r.d).grade, env.difficulty);
}

/** A rider on the road, `d` metres along it, rolling at 8 m/s. */
export function simRider(o: {
	id: string;
	name: string;
	mass: number;
	ftp: number;
	you: boolean;
	watts: number;
	d: number;
}): SimRider {
	return { ...o, v: 8, lap: 0, pace: createPace(8), at: o.d, into: 0 };
}

/** Where a ride has you on its road: metres from the road's first sample, and metres a second. */
export type RideMetre = { m: number; mps: number };

/** A metre further off than this is a start or a seek: the figure goes there at once. */
const JUMP_M = 50;
/** The half-life, in seconds, in which the figure settles onto the ride's metre. */
const SETTLE_S = 0.3;

/**
 * Your figure on the ride's own metre (#3663). The ride says where you are
 * once a second; between its seconds the figure rolls on at the ride's
 * speed and eases onto each new metre as it lands, so it stands where the
 * Skyline's dot does and never jumps. It reads the ride and writes nothing
 * back — rendering never drives the trainer.
 */
export function followMetre() {
	let last = NaN;
	let since = 0;
	return (r: SimRider, ride: RideMetre, real: number) => {
		if (ride.m !== last) {
			last = ride.m;
			since = 0;
		} else since += real;
		const target = ride.m + ride.mps * Math.min(since, 1);
		r.d =
			Math.abs(target - r.d) > JUMP_M
				? target
				: r.d + (target - r.d) * damp(SETTLE_S, real);
		r.at = r.d;
		r.v = ride.mps;
	};
}
