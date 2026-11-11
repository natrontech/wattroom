import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RideCard from './RideCard.svelte';
import { homeRoad, homeRoute } from './home-roads';
import { byId } from '#lib/workout/library.ts';

async function card(id: string) {
	const road = await homeRoute(homeRoad(id)!);
	const workout = byId('recovery-spin')!.workout;
	return render(RideCard, {
		props: { kind: 'free', road, from: 0, workout, summary: '', ftp: 200 },
	}).body;
}

describe("/ride's ways to start a road (#4235)", () => {
	it('offers the foot of its classed climb, as the route page does', async () => {
		// The Valley loop's class IV climb starts 5 km in.
		const body = await card('valley');
		expect(body).toContain('Whole road');
		expect(body).toContain('One climb');
	});

	it('offers no climb that starts where the road does: that is the whole road', async () => {
		// The Pass loop climbs from km 0.
		const body = await card('intro');
		expect(body).toContain('Whole road');
		expect(body).not.toContain('One climb');
	});
});
