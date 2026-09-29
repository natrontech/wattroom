// The ride: every rider is (distance along the route, speed). The world is
// drawn from that pair alone, which is also all a session would ever put
// on the wire per rider — one number more than today's tick.
import { step, trainerGrade } from './physics';
import { at, type Route } from './route';

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
};

export type Env = { windMs: number; difficulty: number };

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
	env: Env,
): void {
	for (const r of riders) {
		const g = at(route, r.d).grade;
		if (!r.you) r.watts = botWatts(r, g, t);
		r.v = step(r.v, r.watts, g, { mass: r.mass }, dt, env.windMs);
		r.d += r.v * dt;
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
	});
	return [
		mk('you', 'You', 80, ftp, 0),
		mk('sven', 'Sven', 74, 270, 1),
		mk('mia', 'Mia', 61, 215, 2),
		mk('tom', 'Tom', 92, 300, 3),
	];
}
