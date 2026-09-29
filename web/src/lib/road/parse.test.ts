// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toGpx } from './fixtures';
import {
	MAX_ROUTE_FILE_BYTES,
	RouteError,
	buildFailureMessage,
	parseRoute,
} from './parse';

afterEach(() => vi.restoreAllMocks());

const TWO = [
	{ lat: 46.6, lon: 7.6, ele: 500 },
	{ lat: 46.601, lon: 7.601, ele: 510 },
];

function tcx(author: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
<Courses><Course><Name>My secret loop</Name><Track>
<Trackpoint><Position><LatitudeDegrees>46.6</LatitudeDegrees><LongitudeDegrees>7.6</LongitudeDegrees></Position><AltitudeMeters>500</AltitudeMeters></Trackpoint>
<Trackpoint><DistanceMeters>3</DistanceMeters></Trackpoint>
<Trackpoint><Position><LatitudeDegrees>46.601</LatitudeDegrees><LongitudeDegrees>7.601</LongitudeDegrees></Position></Trackpoint>
</Track></Course></Courses>
<Author><Name>${author}</Name></Author>
</TrainingCenterDatabase>`;
}

describe('parseRoute', () => {
	it('reads a GPX track with its heights', () => {
		expect(parseRoute(toGpx(TWO))).toEqual({
			points: TWO,
			tracks: [TWO],
			src: 'gpx',
			heights: 'file',
			filled: 0,
		});
	});

	it('reads route points when the file has no track', () => {
		const gpx = toGpx(TWO)
			.replaceAll('trkpt', 'rtept')
			.replace('<trk><trkseg>', '<rte>')
			.replace('</trkseg></trk>', '</rte>');
		expect(parseRoute(gpx).points).toEqual(TWO);
	});

	it('reads a TCX, skipping trackpoints with no position, filling a missing height', () => {
		const { points, src, heights, filled } = parseRoute(tcx('A planner'));
		expect(src).toBe('tcx');
		expect({ heights, filled }).toEqual({ heights: 'file', filled: 1 });
		expect(points).toEqual([
			{ lat: 46.6, lon: 7.6, ele: 500 },
			{ lat: 46.601, lon: 7.601, ele: 500 },
		]);
	});

	it('rides a file with no heights at all, flat, and says it had none', () => {
		const gpx = toGpx(TWO).replace(/<ele>[^<]*<\/ele>/g, '');
		const { points, heights, filled } = parseRoute(gpx);
		expect(points.map((p) => p.ele)).toEqual([0, 0]);
		expect({ heights, filled }).toEqual({ heights: 'none', filled: 0 });
	});

	it('keeps several tracks apart, for the rider to pick one (#3057)', () => {
		const one = toGpx(TWO);
		const two = one.replace(
			'</trk>',
			'</trk><trk><trkseg><trkpt lat="46.7" lon="7.7"><ele>600</ele></trkpt><trkpt lat="46.701" lon="7.701"><ele>610</ele></trkpt></trkseg></trk>',
		);
		const { tracks, points } = parseRoute(two);
		expect(tracks.map((t) => t.length)).toEqual([2, 2]);
		expect(tracks[1][0]).toEqual({ lat: 46.7, lon: 7.7, ele: 600 });
		expect(points).toHaveLength(4);
	});

	// ADR-0063: a Strava export rides owner-only, so it has to be told apart.
	it('flags a file from Strava, GPX or TCX', () => {
		expect(parseRoute(toGpx(TWO, 'StravaGPX')).src).toBe('stravagpx');
		expect(parseRoute(tcx('Strava')).src).toBe('stravagpx');
	});

	it('refuses what it cannot ride, saying why', () => {
		const refusals: [string, RegExp][] = [
			['not xml <<', /not a GPX or TCX/],
			['<kml><Placemark/></kml>', /not a GPX or TCX/],
			[
				'<gpx><trk><trkseg></trkseg></trk></gpx>',
				/fewer than two track points/,
			],
			['x'.repeat(MAX_ROUTE_FILE_BYTES + 1), /over 5 MB/],
		];
		for (const [text, says] of refusals) {
			expect(() => parseRoute(text)).toThrow(RouteError);
			expect(() => parseRoute(text)).toThrow(says);
		}
	});
});

describe('a loaded file that does not become a road', () => {
	it('says what is wrong with the file when the file is at fault', () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		let err: unknown;
		try {
			parseRoute('<gpx><trk><trkseg></trkseg></trk></gpx>');
		} catch (e) {
			err = e;
		}
		expect(buildFailureMessage(err)).toMatch(/fewer than two track points/);
		expect(logged).not.toHaveBeenCalled();
	});

	it('owns a failure that is not the file’s, and logs it', () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const cause = new RangeError('Invalid typed array length');
		const message = buildFailureMessage(cause);
		// A generator bug once read as "not a GPX track", with nothing logged.
		expect(message).not.toMatch(/not a GPX/);
		expect(message).toMatch(/could not be built from this file/);
		expect(logged).toHaveBeenCalledWith(
			'world: a loaded route did not build',
			cause,
		);
	});
});
