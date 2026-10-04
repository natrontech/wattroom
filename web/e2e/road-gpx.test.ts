// A plain unit test, not a Playwright spec: the fixture roads are geometry,
// checked without a browser, under `web` (required) rather than `e2e`.
import { describe, expect, it } from 'vitest';
import { at } from '../src/lib/road/along';
import { toRoute } from '../src/lib/road/route';
import { routeOfRoad } from '../src/lib/world/road-route';
import { generate } from '../src/lib/world/world';
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

/**
 * The world a ride on the hairpin road draws (#3761, TARGETS ride-road-world
 * item 16): built from the road as its owner reads it back, heights and
 * turns, the way RideWorld builds it. A road kept without its turns draws one
 * straight, through a valley that is not the fixture's.
 */
describe("the hairpin road's world", () => {
	const points = [
		...hairpinGpx().matchAll(/lat="([-\d.]+)" lon="([-\d.]+)"><ele>([-\d.]+)</g),
	].map(([, lat, lon, ele]) => ({ lat: +lat, lon: +lon, ele: +ele }));
	const route = routeOfRoad(toRoute(points).road);
	const world = generate(route);
	const pins = world.markers
		.filter((m) => m.kind === 'hairpin')
		.map((m) => m.d);

	it('holds the seven hairpins', () => {
		expect(pins).toHaveLength(7);
	});

	it('has the stack ahead of the approach, and no village on it', () => {
		// 14 s in: about 100 m up the approach, facing along it.
		const me = at(route, 100);
		const on = at(route, 200);
		const hx = on.x - me.x;
		const hz = on.z - me.z;
		for (const d of pins) {
			const p = at(route, d);
			const deg =
				(Math.acos(
					(hx * (p.x - me.x) + hz * (p.z - me.z)) /
						(Math.hypot(hx, hz) * Math.hypot(p.x - me.x, p.z - me.z)),
				) *
					180) /
				Math.PI;
			expect(deg).toBeLessThan(45);
		}
		expect(at(route, pins[0]).ele - me.ele).toBeGreaterThan(50);
		expect(world.villageNames.filter((v) => v.d < pins[0])).toEqual([]);
	});

	it('has the second hairpin just ahead from km 2.3', () => {
		expect(pins.filter((d) => d > 2300 && d < 2600)).toHaveLength(1);
	});
});
