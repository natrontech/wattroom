import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import RideCard from '$lib/ride/RideCard.svelte';
import RideHow from '../../routes/(app)/workouts/routes/[id]/RideHow.svelte';
import { byId } from '$lib/workout/library';

// A production rider (#3352): no dev build, no dev sign-in door, so no
// simulated trainer — the gate roads used to share with it.
vi.mock('$lib/ble/can-simulate', () => ({ canSimulate: () => false }));
// The solo games read the crew list; nothing here is about them.
vi.mock('$lib/nav/crew-live.svelte', () => ({
	crewLive: { loaded: true, crews: [], reload: async () => {} },
}));

const workout = byId('openers')!.workout;

describe('roads reach every rider, marked beta (#3352)', () => {
	it('offers a production rider the Ride card’s ride kinds and its road', () => {
		const { body } = render(RideCard, {
			props: {
				kind: 'free',
				road: null,
				from: 0,
				workout,
				summary: '',
				ftp: 250,
			},
		});
		expect(body).toContain('aria-label="how you ride"');
		expect(body).toContain('Free ride');
		expect(body).toMatch(/<span class="eyebrow">road<\/span>/);
		expect(body).toContain('still being tuned on real trainers');
	});

	it('marks the route page’s Ride as beta', () => {
		const { body } = render(RideHow, {
			props: { id: 'r1', length: 7100, climbs: [], carry: null },
		});
		expect(body).toContain('href="/ride?road=r1"');
		expect(body).toContain('Beta');
	});
});
