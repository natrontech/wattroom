// A plain unit test, not a Playwright spec: the fixture roads are geometry,
// checked without a browser, under `web` (required) rather than `e2e`.
import { expect, it } from 'vitest';
import { climbGpx, hairpinGpx, rollingGpx } from './road-gpx';

/** The track's points in metres east and north of its first, and its heights. */
function track(gpx: string) {
	const pts = [
		...gpx.matchAll(/lat="([-\d.]+)" lon="([-\d.]+)"><ele>([-\d.]+)</g),
	].map(([, lat, lon, ele]) => ({ lat: +lat, lon: +lon, ele: +ele }));
	const perLat = 111_320;
	const perLon = perLat * Math.cos((pts[0].lat * Math.PI) / 180);
	return pts.map((p) => ({
		x: (p.lon - pts[0].lon) * perLon,
		y: (p.lat - pts[0].lat) * perLat,
		ele: p.ele,
	}));
}

/**
 * No fixture road passes over or under itself (#3725). A world holds a road on
 * its ground, and two roads stacked within a few metres of each other at
 * different heights can only be drawn as a cliff: the hairpin fixture's
 * approach once ran 551 m under its own hairpins, and the world a design
 * capture drew from it was a trench.
 */
it.each([
	['climb', climbGpx],
	['hairpin', hairpinGpx],
	['rolling', rollingGpx],
])('the %s road never runs over or under itself', (_, road) => {
	const pts = track(road());
	let worst = 0;
	for (let i = 0; i < pts.length; i++)
		for (let j = i + 1; j < pts.length; j++) {
			const a = pts[i];
			const b = pts[j];
			if (Math.hypot(a.x - b.x, a.y - b.y) < 40)
				worst = Math.max(worst, Math.abs(a.ele - b.ele));
		}
	expect(worst).toBeLessThan(40);
});
