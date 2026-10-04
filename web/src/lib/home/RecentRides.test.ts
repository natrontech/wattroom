import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RecentRides from './RecentRides.svelte';
import type { ServerRide } from '$lib/ride/list';

const ride = {
	id: 'r1',
	workoutName: 'Smoke Test',
	startedAt: '2026-10-04T08:00:00Z',
	seconds: 90,
	kj: 8,
} as ServerRide;

// TARGETS Flows rule 2 (#3773): Home's row names the ride, as History's do.
describe('Home recent rides', () => {
	it('leads each row with the ride name', () => {
		const html = render(RecentRides, { props: { rides: [ride] } }).body;
		expect(html).toContain('Smoke Test');
		expect(html.indexOf('Smoke Test')).toBeLessThan(html.indexOf('kJ'));
	});
});
