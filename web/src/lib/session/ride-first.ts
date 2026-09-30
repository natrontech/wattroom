import type { CrewPlan } from '$lib/crew-schedule';
import type { Workout } from '$lib/workout/types';

/**
 * Where a planned road session's "Ride it first" goes (#3621). Its planner
 * owns the route — only an owner may put one in a plan (ADR-0063) — and
 * rides their own road from the plan's metre, saved against it. Anyone else
 * rides the crew's cut the plan carries, saved as a plain free ride. Null for
 * a plan on no road, or one whose road did not come with it.
 */
export function rideFirstHref(plan: CrewPlan, crew: string): string | null {
	let road: Workout['road'];
	try {
		road = (JSON.parse(plan.workoutJson) as Workout).road;
	} catch {
		return null;
	}
	if (!road?.routeId) return null;
	if (plan.mine)
		return `/ride?road=${encodeURIComponent(road.routeId)}&from=${Math.round(road.fromM)}`;
	return road.profile
		? `/ride?crew=${encodeURIComponent(crew)}&plan=${encodeURIComponent(plan.id)}`
		: null;
}
