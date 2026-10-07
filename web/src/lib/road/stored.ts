import type { Climb } from './climbs';
import { frameOf, project } from './line';
import { decodePolyline6, unpackRoad, type Road } from './road';

/**
 * A route as its owner reads it back (#3024, #3061): GET /api/routes lists
 * them, GET /api/routes/{id} adds the road, and /shape the owner's map.
 */
export type StoredRoute = {
	id: string;
	/** The owner's own name; every other surface shows generatedName (#3055). */
	name: string;
	generatedName: string;
	src: string;
	lengthM: number;
	gainM: number;
	climbs: Climb[];
	/** The server kept the map as well as the heights. */
	hasPlace: boolean;
	/** From strava.com: it rides with its owner alone (ADR-0063). */
	ownerOnly: boolean;
	createdAt: string;
	/** On the list only (#3683): the owner's own rides of the road, and the latest's time. */
	rides?: number;
	lastRiddenAt?: string;
	/** On the list only: where the latest ride alone stopped short of the end. */
	carryOnM?: number;
	/** On one route's read only: packRoad's bytes, base64. */
	road?: string;
	/** Why the map is missing, when it is. */
	hint?: string;
	/** On one route's read: it ends where it began. Absent before #3680. */
	loop?: boolean;
};

/** The stored road, from the base64 one route's read carries. */
export function roadOf(route: StoredRoute): Road | null {
	if (!route.road) return null;
	return unpackRoad(Uint8Array.from(atob(route.road), (c) => c.charCodeAt(0)));
}

/** The owner's map as metres east and south, for RouteShape. */
export function shapeLine(shape: string): { x: number[]; z: number[] } {
	const points = decodePolyline6(shape).map((p) => ({ ...p, ele: 0 }));
	const { x, z } = project(points, frameOf(points));
	return { x, z };
}

/**
 * The route page's stat row (#3680), part by part: “7.1 km”, “563 m
 * climbed”, “1 classed climb”, “point to point”. Loop or point to point only
 * where it is known — from the importer, or from the owner's map — never
 * guessed.
 */
export function statRow(
	route: StoredRoute,
	loop: boolean | undefined,
): string[] {
	const classed = route.climbs.filter((c) => c.cls).length;
	return [
		`${(route.lengthM / 1000).toFixed(1)} km`,
		`${route.gainM} m climbed`,
		classed === 0
			? 'no classed climb'
			: `${classed} classed climb${classed === 1 ? '' : 's'}`,
		...(loop === undefined ? [] : [loop ? 'loop' : 'point to point']),
	];
}
