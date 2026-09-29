/**
 * A route file becomes points (#3023): a GPX's track or route points, or a
 * TCX's trackpoints, with whatever elevation they carry. The browser's own XML
 * parser reads the file, so nothing here guesses at markup; FIT comes later.
 *
 * The file's <name> is not read. A route's name is generated from its numbers
 * (road.ts), so a place never travels in it (ADR-0063).
 */

export type TrackPoint = { lat: number; lon: number; ele: number };

/**
 * Where a route came from: its format, or strava.com. A Strava export rides
 * owner-only (ADR-0063), and telling one apart is a heuristic — the file's
 * creator says Strava — which the copy that explains it says too.
 */
export type RouteSource = 'gpx' | 'tcx' | 'stravagpx';

/** docs/SPEC.md "Route rides": the file a rider imports is at most 5 MB. */
export const MAX_ROUTE_FILE_BYTES = 5 << 20;

/** A file this app cannot ride, in words a rider can act on. */
export class RouteError extends Error {}

/**
 * What to tell a rider whose file did not become a road. A RouteError is the
 * file's fault and says what is wrong with it; anything else is ours, so it is
 * logged and owned rather than blamed on the file.
 */
export function buildFailureMessage(err: unknown): string {
	if (err instanceof RouteError) return err.message;
	console.error('world: a loaded route did not build', err);
	return 'The world could not be built from this file. The browser console has the reason. Try another GPX, or a shorter stretch of this one.';
}

const numberIn = (el: Element | undefined): number =>
	el?.textContent?.trim() ? Number(el.textContent) : NaN;

const first = (el: Element | Document, tag: string): Element | undefined =>
	el.getElementsByTagName(tag)[0];

function gpxPoints(doc: Document): TrackPoint[] {
	// A file carrying both a recorded track and a planned route of the same
	// road would otherwise ride it twice.
	let els = doc.getElementsByTagName('trkpt');
	if (els.length === 0) els = doc.getElementsByTagName('rtept');
	return Array.from(els, (el) => ({
		lat: Number(el.getAttribute('lat') ?? NaN),
		lon: Number(el.getAttribute('lon') ?? NaN),
		ele: numberIn(first(el, 'ele')),
	}));
}

function tcxPoints(doc: Document): TrackPoint[] {
	return Array.from(doc.getElementsByTagName('Trackpoint'), (el) => ({
		lat: numberIn(first(el, 'LatitudeDegrees')),
		lon: numberIn(first(el, 'LongitudeDegrees')),
		ele: numberIn(first(el, 'AltitudeMeters')),
	}));
}

const STRAVA = /strava/i;

/** A GPX whose creator says Strava; a TCX whose Author or Creator is named Strava. */
function fromStrava(doc: Document, gpx: boolean): boolean {
	if (gpx)
		return STRAVA.test(doc.documentElement.getAttribute('creator') ?? '');
	return ['Author', 'Creator'].some((tag) => {
		const who = first(doc, tag);
		return STRAVA.test((who && first(who, 'Name')?.textContent) ?? '');
	});
}

/** A file with no elevation still rides, flat; a gap takes the last height before it. */
function fillHeights(points: TrackPoint[]) {
	let last = points.find((p) => Number.isFinite(p.ele))?.ele ?? 0;
	for (const p of points) {
		if (Number.isFinite(p.ele)) last = p.ele;
		else p.ele = last;
	}
}

export function parseRoute(text: string): {
	points: TrackPoint[];
	src: RouteSource;
} {
	if (new TextEncoder().encode(text).byteLength > MAX_ROUTE_FILE_BYTES)
		throw new RouteError(
			'This file is over 5 MB, more than a route needs. Export the route alone, without laps or sensor data, and pick it again.',
		);
	const doc = new DOMParser().parseFromString(text, 'application/xml');
	const root = doc.documentElement?.localName;
	const gpx = root === 'gpx';
	if (
		doc.getElementsByTagName('parsererror').length > 0 ||
		(!gpx && root !== 'TrainingCenterDatabase')
	)
		throw new RouteError(
			'This file is not a GPX or TCX route. Export the route from your planner as GPX, and pick that file.',
		);
	const points = (gpx ? gpxPoints(doc) : tcxPoints(doc)).filter(
		(p) => Number.isFinite(p.lat) && Number.isFinite(p.lon),
	);
	if (points.length < 2)
		throw new RouteError(
			'This file has fewer than two track points. Export the track again, or pick another file.',
		);
	fillHeights(points);
	const src = fromStrava(doc, gpx) ? 'stravagpx' : gpx ? 'gpx' : 'tcx';
	return { points, src };
}
