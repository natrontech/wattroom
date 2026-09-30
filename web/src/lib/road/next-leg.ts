import { api } from '$lib/api';
import type { LostRoad } from '$lib/channel/lost-road';
import type { Workout } from '$lib/workout/types';
import { onRoute } from './compile';
import { ownerFromM, rideTogether } from './ride-together';
import { roadStep, type Road } from './road';
import type { Climb } from './climbs';
import { roadOf, type StoredRoute } from './stored';

/**
 * The next leg of a road session (#3103): the road from where the bunch
 * stopped, planned for next week. A road's own workout (its blocks end at
 * the road's metres) goes on as that road's workout from there; any other
 * workout rides the road again from there, its blocks as written. Null when
 * the bunch was at the road's end and there is no road left.
 */
export function nextLeg(
	ended: LostRoad,
	route: { id: string; genName: string; road: Road; climbs: Climb[] },
): Workout | null {
	const fromM = ownerFromM(route.road, ended.route.fromM ?? 0);
	if (fromM >= route.road.length - roadStep(route.road)) return null;
	const rode = JSON.parse(ended.workoutJson) as Workout;
	if (rode.road?.stepEndM?.length)
		return rideTogether(route, { fromM, toM: route.road.length }).workout;
	return onRoute(rode, route, fromM);
}

/**
 * The next leg, read off the owner's own route: the whole road and its
 * climbs, which only the owner is given — the same rule the server holds a
 * road plan to (ADR-0063). A refusal is the words for the rider.
 */
export async function loadNextLeg(
	ended: LostRoad,
): Promise<{ ok: true; workout: Workout } | { ok: false; error: string }> {
	const res = await api<StoredRoute>(
		`/api/routes/${encodeURIComponent(ended.route.id)}`,
	);
	if (!res.ok) return { ok: false, error: res.error.message };
	const road = roadOf(res.data);
	if (!road) return { ok: false, error: 'That route has no road to plan.' };
	const workout = nextLeg(ended, {
		id: res.data.id,
		genName: res.data.generatedName,
		road,
		climbs: res.data.climbs,
	});
	return workout
		? { ok: true, workout }
		: {
				ok: false,
				error: 'The bunch rode this road to its end. There is no next leg.',
			};
}

/** Next week, at the time this session started. */
export const nextLegAt = (ended: LostRoad) =>
	new Date(ended.startedAt + 7 * 24 * 3600 * 1000);
