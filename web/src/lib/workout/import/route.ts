import { MaxLegSeconds, MaxRoadGradePct, MinRoadGradePct } from '$lib/protocol';
import { frameOf, project } from '$lib/road/line';
import { referenceSeconds } from '$lib/road/pace';
import {
	MAX_ROUTE_FILE_BYTES,
	parseRoute,
	RouteError,
	type RouteSource,
	type TrackPoint,
} from '$lib/road/parse';
import { lengthOf, toRoute, type Route } from '$lib/road/route';

/**
 * A route file through the importer (#3057): $lib/road does the work, and
 * this says what came of it — the road, where it came from, what was fixed
 * on the way, and how long it rides — or what the rider has to choose first.
 * Like a workout, the file never leaves the browser; only what $lib/road made
 * of it is saved.
 */

export type ImportedRoute = {
	route: Route;
	src: RouteSource;
	/** Where the heights came from, in POST /api/routes' words. */
	eleSource: 'file' | 'none';
	/** What was fixed, in plain words; empty when only the usual smoothing ran. */
	fixes: string[];
	/** The reference rider's time over it, and the legs that cuts it into. */
	referenceSeconds: number;
	legs: number;
};

/** What the rider chose after a first look: which track, and a flat road. */
export type RouteChoice = { track?: number; flat?: boolean };

export type RouteOutcome =
	| { ok: true; imported: ImportedRoute }
	| { ok: false; error: string }
	/** Several tracks in one file: one label each, to pick from. */
	| { ok: false; tracks: string[] }
	/** No heights at all: it rides, but only flat, so ask first. */
	| { ok: false; noHeights: true };

const minus = (n: number) => String(n).replace('-', '−');

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

function fixesOf(route: Route, filled: number, flat: boolean): string[] {
	const out: string[] = [];
	const { spikes, heldM } = route.fixed;
	if (spikes)
		out.push(
			`${plural(spikes, 'GPS fix', 'GPS fixes')} jumped off the road and back, and ${spikes === 1 ? 'was' : 'were'} cut out.`,
		);
	if (flat) out.push('The file carries no heights, so the road is flat.');
	else if (filled)
		out.push(
			`${plural(filled, 'point has', 'points have')} no height of ${filled === 1 ? 'its' : 'their'} own and take${filled === 1 ? 's' : ''} the one before.`,
		);
	if (heldM)
		out.push(
			`The file climbs steeper than any road over ${Math.round(heldM)} m, so the grade there is held to ${minus(MinRoadGradePct)} … +${MaxRoadGradePct} %.`,
		);
	return out;
}

function trackLabel(points: TrackPoint[], i: number): string {
	const km = lengthOf(project(points, frameOf(points))) / 1000;
	return `Track ${i + 1} · ${km.toFixed(1)} km`;
}

/** A RouteError is the file's, in words the rider can act on; anything else is ours. */
function failed(err: unknown): RouteOutcome {
	if (err instanceof RouteError) return { ok: false, error: err.message };
	console.error('import: a route file did not build', err);
	return {
		ok: false,
		error:
			'WattRoom could not build a road from this file — that is on us, not the file. Try exporting the route again.',
	};
}

export function importRoute(
	source: string,
	choice: RouteChoice = {},
): RouteOutcome {
	let parsed: ReturnType<typeof parseRoute>;
	try {
		parsed = parseRoute(source);
	} catch (err) {
		return failed(err);
	}
	const { tracks, src, heights, filled } = parsed;
	if (tracks.length > 1 && choice.track === undefined)
		return { ok: false, tracks: tracks.map(trackLabel) };
	if (heights === 'none' && !choice.flat) return { ok: false, noHeights: true };
	let route: Route;
	try {
		route = toRoute(tracks[choice.track ?? 0] ?? tracks[0]);
	} catch (err) {
		return failed(err);
	}
	const seconds = referenceSeconds(route.road);
	return {
		ok: true,
		imported: {
			route,
			src,
			eleSource: heights,
			// A count over the whole file says nothing true about one of its tracks.
			fixes: fixesOf(route, tracks.length > 1 ? 0 : filled, heights === 'none'),
			referenceSeconds: seconds,
			legs: Math.ceil(seconds / MaxLegSeconds),
		},
	};
}

/** Reads a picked route file, refusing one past the ceiling before reading it. */
export async function readRouteFile(
	file: File,
): Promise<{ ok: true; source: string } | { ok: false; error: string }> {
	if (file.size > MAX_ROUTE_FILE_BYTES)
		return {
			ok: false,
			error: `“${file.name}” is ${(file.size / (1 << 20)).toFixed(1)} MB. A route file is at most ${MAX_ROUTE_FILE_BYTES >> 20} MB — export the route alone, without laps or sensor data.`,
		};
	try {
		return { ok: true, source: await file.text() };
	} catch {
		return {
			ok: false,
			error: `“${file.name}” could not be read. Copy it somewhere local and pick it again.`,
		};
	}
}

/** packRoad's bytes as the base64 POST /api/routes reads into a []byte. */
export function base64Of(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}
