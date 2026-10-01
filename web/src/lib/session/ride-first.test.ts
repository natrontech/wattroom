import { describe, expect, it } from 'vitest';
import type { CrewPlan } from '$lib/crew-schedule';
import { rideFirstHref } from './ride-first';

const plan = (road: object | undefined, mine = false): CrewPlan =>
	({
		id: 'p1',
		workoutName: 'Road',
		workoutJson: JSON.stringify({ name: 'Road', steps: [], road }),
		startsAt: '2026-10-06T18:00:00Z',
		createdBy: 'Coach',
		mine,
	}) as CrewPlan;

describe('Ride it first (#3621)', () => {
	it('sends the route’s owner to their own road at the plan’s metre', () => {
		expect(
			rideFirstHref(
				plan({ routeId: 'r1', fromM: 1234.6, toM: 3000 }, true),
				'c1',
			),
		).toBe('/ride?road=r1&from=1235');
	});

	it('sends anyone else to the crew’s cut the plan carries', () => {
		const cut = {
			routeId: 'r1',
			fromM: 900,
			toM: 3000,
			profile: 'AQ==',
			originM: 400,
		};
		expect(rideFirstHref(plan(cut), 'c1')).toBe('/ride?crew=c1&plan=p1');
	});

	it('offers nothing off a road, or when the road did not come with it', () => {
		expect(rideFirstHref(plan(undefined), 'c1')).toBeNull();
		expect(
			rideFirstHref(plan({ routeId: 'r1', fromM: 0, toM: 3000 }), 'c1'),
		).toBeNull();
	});
});
