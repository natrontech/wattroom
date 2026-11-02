import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RideHow from './RideHow.svelte';

const props = { id: 'r1', length: 7100, climbs: [], carry: null };

describe('how to ride a route (#3680)', () => {
	it('opens the ride where this device can reach a trainer', () => {
		const { body } = render(RideHow, { props });
		expect(body).toContain('href="/ride?road=r1"');
	});

	it('rides its own workout from leg 1 (#3601)', () => {
		const { body } = render(RideHow, { props });
		expect(body).toContain('Ride its workout');
	});

	it('offers a workout on it, Terrain Match picking the start (#3681)', () => {
		const { body } = render(RideHow, { props });
		expect(body).toContain('Workout on it');
		expect(body).toContain('Pick a workout; Terrain Match picks the start');
	});

	it('shows how on a device that cannot, its primary disabled with the reason', () => {
		const { body } = render(RideHow, { props: { ...props, spectator: true } });
		expect(body).toContain('Which stretch');
		expect(body).not.toContain('href="/ride');
		expect(body).toMatch(/<button[^>]*disabled[^>]*>Ride it<\/button>/);
		expect(body).toContain("This device can't reach a trainer");
	});
});

describe('which stretch: one climb (#4235)', () => {
	const climb = (startM: number) => ({
		startM,
		topM: startM + 2000,
		gainM: 120,
		cls: 'IV' as const,
	});

	it('offers a classed climb that starts down the road', () => {
		const { body } = render(RideHow, {
			props: { ...props, climbs: [climb(3000)] },
		});
		expect(body).toContain('One climb');
	});

	it('offers no climb from km 0, which is the whole road', () => {
		const { body } = render(RideHow, {
			props: { ...props, climbs: [climb(0)] },
		});
		expect(body).not.toContain('One climb');
	});
});
