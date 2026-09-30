import type { ControlRoute, ServerTick } from '$lib/protocol';

/**
 * A session's road as its coach's screen remembers it (#3103): the workout,
 * the route and which way it runs, and where the bunch last was. A restart
 * loses the session (ADR-0052); this is what puts the bunch back on its road,
 * a new session picked from the bunch's last metre.
 */
export interface LostRoad {
	workoutName: string;
	workoutJson: string;
	totalSeconds: number;
	route: ControlRoute;
}

/**
 * The road a live tick shows this rider coaching, or null: someone else's
 * session, no road, or a road that does not loop with the bunch already at
 * its end, where there is nothing left to resume.
 */
export function roadOf(t: ServerTick, me: string | undefined): LostRoad | null {
	const s = t.state;
	const route = s?.route;
	const bunchM = t.world?.bunchM;
	if (
		!me ||
		s?.coach !== me ||
		!route ||
		!s.workoutName ||
		bunchM === undefined
	)
		return null;
	if (!route.loop && bunchM >= route.lengthM - 1) return null;
	return {
		workoutName: s.workoutName,
		workoutJson: referenceOnly(s.workoutJson ?? ''),
		totalSeconds: s.totalSeconds ?? 0,
		route: {
			id: route.id,
			fromM: Math.min(bunchM, route.lengthM - 1),
			reverse: route.reverse,
			loop: route.loop,
		},
	};
}

/**
 * The workout as a pick may carry it: its road by reference only. The tick's
 * copy has the crew's cut attached (#3051), and the hub refuses a pick that
 * carries one.
 */
export function referenceOnly(workoutJson: string): string {
	let workout: { road?: Record<string, unknown> };
	try {
		workout = JSON.parse(workoutJson);
	} catch {
		return workoutJson;
	}
	if (!workout?.road) return workoutJson;
	const { routeId, fromM, toM, stepEndM } = workout.road;
	return JSON.stringify({
		...workout,
		road: { routeId, fromM, toM, stepEndM },
	});
}

/** A resume's kilometre, as the button says it: "km 14.2". */
export const resumeKm = (road: LostRoad) =>
	((road.route.fromM ?? 0) / 1000).toFixed(1);
