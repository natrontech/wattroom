import { homeRoad, homeRoute } from '$lib/ride/home-roads';
import { api } from '$lib/api';
import type { Road } from '$lib/road/road';
import { fetchCrewSchedule } from '$lib/crew-schedule';
import { roadOf, type StoredRoute } from '$lib/road/stored';
import { roadOf as attachedRoadOf } from '$lib/workout/road-workout';

/** A route with its road, ready to ride. */
export interface RideableRoute {
	id: string;
	name: string;
	/** The generated name legs go out under, never the owner's rename (#3055). */
	generatedName?: string;
	road: Road;
	/** It ends where it began (#3680): a ride on it rolls into the next lap (#4261). */
	loop?: boolean;
	/**
	 * Someone else's road, the crew's cut of it (#3621): ridden, never saved
	 * against — the server keeps a ride only on the rider's own route.
	 */
	borrowed?: true;
}

/** The rider's own routes, newest first, as GET /api/routes lists them. */
export async function myRoutes(): Promise<
	{ ok: true; routes: StoredRoute[] } | { ok: false; error: string }
> {
	const res = await api<{ routes: StoredRoute[] }>('/api/routes');
	return res.ok
		? { ok: true, routes: res.data.routes }
		: { ok: false, error: res.error.message };
}

/**
 * Where to carry on along a road (#3205): where the rider's last ride of it
 * alone stopped — its first metre plus the metres the replay kept — when that
 * was short of the end. A ride that reached the end, or rode on past it in
 * laps, left nothing to carry on from.
 */
export async function carryOnFrom(
	routeId: string,
	length: number,
): Promise<number | null> {
	// WattRoom's own roads keep no attempts on any account (#4248).
	if (homeRoad(routeId)) return null;
	const res = await api<{ attempts: CarryAttempt[] }>(
		`/api/routes/${encodeURIComponent(routeId)}/attempts`,
	);
	// ponytail: an offer that could not be read is not offered; From the
	// start still rides.
	return res.ok ? carryOnOf(res.data.attempts, length) : null;
}

type CarryAttempt = { fromM?: number; distanceM?: number; kind: string };

/** carryOnFrom over attempts already read, newest first as the server sends them. */
export function carryOnOf(
	attempts: CarryAttempt[],
	length: number,
): number | null {
	const last = attempts.find((a) => a.kind !== 'together');
	if (!last?.distanceM) return null;
	const m = (last.fromM ?? 0) + last.distanceM;
	// Metres are kept whole: a ride to the end may land a metre short.
	return m + 1 < length ? m : null;
}

/** /ride?road=intro (#3218): the first-run card's road, built in, on no account. */
export const INTRO_ROAD_ID = 'intro';

/**
 * One route and its road. The owner's own read carries the whole road,
 * packed (road.ts); nothing else is needed to ride it.
 */
export async function loadRoad(
	id: string,
): Promise<{ ok: true; route: RideableRoute } | { ok: false; error: string }> {
	// WattRoom's own roads (#4248), built here: the first-run road among them.
	const home = homeRoad(id);
	if (home) return { ok: true, route: await homeRoute(home) };
	const res = await api<StoredRoute>(`/api/routes/${encodeURIComponent(id)}`);
	if (!res.ok) return { ok: false, error: res.error.message };
	try {
		const road = roadOf(res.data);
		if (!road) return { ok: false, error: 'That route has no road to ride.' };
		return {
			ok: true,
			route: {
				id: res.data.id,
				name: res.data.name,
				generatedName: res.data.generatedName,
				road,
				loop: !!res.data.loop,
			},
		};
	} catch {
		return { ok: false, error: 'That road could not be read. Try again.' };
	}
}

/**
 * A planned session's road as this rider will receive it (#3621): the crew's
 * cut the plan carries, from the crew's metre — the plan's metre on the
 * owner's road less where the cut starts, as `crewFromM` has it.
 */
export async function loadPlanRoad(
	crew: string,
	planId: string,
): Promise<
	| { ok: true; route: RideableRoute; from: number }
	| { ok: false; error: string }
> {
	const res = await fetchCrewSchedule(crew);
	if (!res.ok) return { ok: false, error: res.error.message };
	const plan = res.data.sessions.find((p) => p.id === planId);
	if (!plan)
		return {
			ok: false,
			error: 'That session is not on your crew’s schedule any more.',
		};
	let cut: ReturnType<typeof attachedRoadOf> = null;
	try {
		cut = attachedRoadOf(JSON.parse(plan.workoutJson));
	} catch {
		/* said below */
	}
	if (!cut)
		return { ok: false, error: 'That session’s road did not come with it.' };
	return {
		ok: true,
		route: {
			id: cut.routeId,
			name: plan.workoutName,
			road: cut.road,
			borrowed: true,
		},
		from: Math.max(0, cut.fromM - cut.originM),
	};
}
