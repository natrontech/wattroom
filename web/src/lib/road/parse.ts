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

const gpxPoint = (el: Element): TrackPoint => ({
	lat: Number(el.getAttribute('lat') ?? NaN),
	lon: Number(el.getAttribute('lon') ?? NaN),
	ele: numberIn(first(el, 'ele')),
});

const tcxPoint = (el: Element): TrackPoint => ({
	lat: numberIn(first(el, 'LatitudeDegrees')),
	lon: numberIn(first(el, 'LongitudeDegrees')),
	ele: numberIn(first(el, 'AltitudeMeters')),
});

const placed = (p: TrackPoint) =>
	Number.isFinite(p.lat) && Number.isFinite(p.lon);

/** Each wrapper's points, placed ones only; a file with none of them is one group. */
function grouped(
	doc: Document,
	wrapper: string,
	tag: string,
	read: (el: Element) => TrackPoint,
): TrackPoint[][] {
	const wrappers = Array.from(doc.getElementsByTagName(wrapper));
	const groups = wrappers.length
		? wrappers.map((w) => Array.from(w.getElementsByTagName(tag), read))
		: [Array.from(doc.getElementsByTagName(tag), read)];
	return groups.map((g) => g.filter(placed)).filter((g) => g.length > 0);
}

/**
 * The file's tracks: a GPX's <trk>s — its <rte>s when it has no track, since
 * a file carrying both a recorded track and a planned route of the same road
 * would otherwise ride it twice — and a TCX's <Course>s, else its
 * <Activity>s. Several tracks are a choice the rider makes (#3057).
 */
function tracksOf(doc: Document, gpx: boolean): TrackPoint[][] {
	if (gpx) {
		const tracks = grouped(doc, 'trk', 'trkpt', gpxPoint);
		return tracks.length ? tracks : grouped(doc, 'rte', 'rtept', gpxPoint);
	}
	const courses = grouped(doc, 'Course', 'Trackpoint', tcxPoint);
	return courses.length
		? courses
		: grouped(doc, 'Activity', 'Trackpoint', tcxPoint);
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

/**
 * A file with no elevation still rides, flat; a gap takes the last height
 * before it. Answers how many gaps it filled.
 */
function fillHeights(points: TrackPoint[]): number {
	let last = points.find((p) => Number.isFinite(p.ele))?.ele ?? 0;
	let filled = 0;
	for (const p of points) {
		if (Number.isFinite(p.ele)) last = p.ele;
		else {
			p.ele = last;
			filled++;
		}
	}
	return filled;
}

export function parseRoute(text: string): {
	/** Every track's points, in file order — what the world view rides. */
	points: TrackPoint[];
	/** The same points by track, for a file carrying several. */
	tracks: TrackPoint[][];
	src: RouteSource;
	/** Where the heights came from: the file, or nowhere — a flat road. */
	heights: 'file' | 'none';
	/** Points with no height of their own, given the one before them. */
	filled: number;
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
	const tracks = tracksOf(doc, gpx);
	const points = tracks.flat();
	if (points.length < 2)
		throw new RouteError(
			'This file has fewer than two track points. Export the track again, or pick another file.',
		);
	const heights = points.some((p) => Number.isFinite(p.ele)) ? 'file' : 'none';
	const filled = fillHeights(points);
	const src = fromStrava(doc, gpx) ? 'stravagpx' : gpx ? 'gpx' : 'tcx';
	// A file with no heights at all is flat, not a file with every gap filled.
	return {
		points,
		tracks,
		src,
		heights,
		filled: heights === 'file' ? filled : 0,
	};
}
