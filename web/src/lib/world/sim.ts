// The ride: every rider is (distance along the route, speed). The world is
// drawn from that pair alone, which is also all a session would ever put
// on the wire per rider — one number more than today's tick.
import { PaceDefaultCdA } from '$lib/protocol';
import { createPace, type Pace } from '$lib/road/pace';
import { type Route } from '$lib/road/route';
import { at } from '$lib/road/along';

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
};

export type Env = { difficulty: number };

// A bot rides like a person: harder on climbs, soft on descents, a little noise.
export function botWatts(r: SimRider, grade: number, t: number): number {
	const push =
		grade > 2 ? 1.05 + Math.min(0.15, grade / 60) : grade < -3 ? 0.35 : 0.82;
	const wobble =
		1 + 0.06 * Math.sin(t / 7 + r.mass) + 0.03 * Math.sin(t / 1.7 + r.ftp);
	return r.ftp * push * wobble;
}

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
			if (!r.you) r.watts = botWatts(r, g, t);
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

// You, on your own FTP, and a small crew, a few wheels apart so the camera
// sees you and them.
export function defaultRiders(watts: number, ftp: number): SimRider[] {
	const mk = (
		id: string,
		name: string,
		mass: number,
		ftp: number,
		i: number,
	): SimRider => ({
		id,
		name,
		mass,
		ftp,
		you: i === 0,
		watts: i === 0 ? watts : 0,
		d: i * 7,
		v: 8,
		lap: 0,
		pace: createPace(8),
		at: i * 7,
		into: 0,
	});
	return [
		mk('you', 'You', 80, ftp, 0),
		mk('sven', 'Sven', 74, 270, 1),
		mk('mia', 'Mia', 61, 215, 2),
		mk('tom', 'Tom', 92, 300, 3),
	];
}
