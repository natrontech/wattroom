import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RideHow from './RideHow.svelte';

const props = { id: 'r1', length: 7100, climbs: [], carry: null };

describe('how to ride a route (#3680)', () => {
	it('opens the ride where this device can reach a trainer', () => {
		const { body } = render(RideHow, { props });
		expect(body).toContain('href="/ride?road=r1"');
	});

	it('shows how on a device that cannot, its primary disabled with the reason', () => {
		const { body } = render(RideHow, { props: { ...props, spectator: true } });
		expect(body).toContain('Which stretch');
		expect(body).not.toContain('href="/ride');
		expect(body).toMatch(/<button[^>]*disabled[^>]*>Ride it<\/button>/);
		expect(body).toContain("This device can't reach a trainer");
	});
});
