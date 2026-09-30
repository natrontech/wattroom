import { api } from '$lib/api';
import { canSimulate } from '$lib/ble/can-simulate';
import type { Road } from '$lib/road/road';
import { roadOf, type StoredRoute } from '$lib/road/stored';

/**
 * May this screen ride a road (#3027)? The route ride lands behind a dev
 * gate, as gears do: dev builds only, until the Kickr sitting's numbers are
 * final and the roads switch-on (#3352) lifts it.
 */
export function roadsEnabled(): boolean {
	return canSimulate();
}

/** One of the rider's own routes, as the list names it. */
export interface RouteSummary {
	id: string;
	name: string;
	lengthM: number;
	gainM: number;
}

/** A route with its road, ready to ride. */
export interface RideableRoute {
	id: string;
	name: string;
	road: Road;
}

/** The rider's own routes, newest first, as GET /api/routes lists them. */
export async function myRoutes(): Promise<
	{ ok: true; routes: RouteSummary[] } | { ok: false; error: string }
> {
	const res = await api<{ routes: RouteSummary[] }>('/api/routes');
	return res.ok
		? { ok: true, routes: res.data.routes }
		: { ok: false, error: res.error.message };
}

/**
 * One route and its road. The owner's own read carries the whole road,
 * packed (road.ts); nothing else is needed to ride it.
 */
export async function loadRoad(
	id: string,
): Promise<{ ok: true; route: RideableRoute } | { ok: false; error: string }> {
	const res = await api<StoredRoute>(`/api/routes/${encodeURIComponent(id)}`);
	if (!res.ok) return { ok: false, error: res.error.message };
	try {
		const road = roadOf(res.data);
		if (!road) return { ok: false, error: 'That route has no road to ride.' };
		return { ok: true, route: { id: res.data.id, name: res.data.name, road } };
	} catch {
		return { ok: false, error: 'That road could not be read. Try again.' };
	}
}
