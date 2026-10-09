import { describe, expect, it } from 'vitest';
import { localPath, rideBackLink, routeBackLink, withBack } from './back-link';

const offSite = [
	null,
	'',
	'ride',
	'//evil.example',
	'https://evil.example',
	'/\\evil.example',
];

describe("the route page's back link (Flows rule 4)", () => {
	it('returns to the picker it was opened from', () => {
		expect(routeBackLink('/ride')).toEqual({ href: '/ride', label: 'Ride' });
		expect(routeBackLink('/crew/c1/v/v1')).toEqual({
			href: '/crew/c1/v/v1',
			label: 'Back',
		});
	});

	it('falls back to Workouts, and never leaves the site', () => {
		const home = { href: '/workouts', label: 'Workouts' };
		for (const back of offSite)
			expect(routeBackLink(back), String(back)).toEqual(home);
	});
});

describe("the ride page's back link (#3874)", () => {
	const road = { routeId: 'r1', name: 'Home loop' };

	it('carries the page it came from through the link, and reads it back', () => {
		const from = '/workouts/routes/r1?back=%2Fride';
		const href = withBack('/history/ride1', from);
		expect(localPath(new URL(href, 'http://x').searchParams.get('back'))).toBe(
			from,
		);
	});

	it("returns to the road's page under the road's name", () => {
		expect(rideBackLink('/workouts/routes/r1?back=%2Fride', road)).toEqual({
			href: '/workouts/routes/r1?back=%2Fride',
			label: 'Home loop',
		});
	});

	it('says Back for any other page, another road included', () => {
		expect(rideBackLink('/workouts/routes/r10', road).label).toBe('Back');
		expect(rideBackLink('/home').label).toBe('Back');
	});

	it('falls back to Rides, and never leaves the site', () => {
		const rides = { href: '/history', label: 'Rides' };
		for (const back of offSite)
			expect(rideBackLink(back, road), String(back)).toEqual(rides);
	});
});

describe('withBack', () => {
	it('leaves a link with nowhere to go back to as it is', () => {
		expect(withBack('/workouts/routes/r1')).toBe('/workouts/routes/r1');
		expect(withBack('/workouts/routes/r1', '/ride')).toBe(
			'/workouts/routes/r1?back=%2Fride',
		);
	});
});
