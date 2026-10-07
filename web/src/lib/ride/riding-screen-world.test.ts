import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { SimulatedTrainer } from '$lib/ble/simulated';
import { legsRoad } from '$lib/road/fixtures';
import { createRideSession } from '$lib/workout/session.svelte';
import { withProfile } from '$lib/workout/road-workout';
import type { Workout } from '$lib/workout/types';
import RidingScreen from './RidingScreen.svelte';

vi.mock('$lib/hud/feed', () => ({ publishHud: () => {} }));
// This device draws the world: the flag on and a browser that can (#3031).
vi.mock('$lib/world/world-view.svelte', () => ({
	createWorldView: () => ({
		on: true,
		reason: null,
		fail() {},
		flatten() {},
		retry() {},
		// Never resolves: a server render draws the pending branch.
		load: () => new Promise(() => {}),
	}),
}));

/**
 * The world draws a ride that carries a road, and only such a ride (#3663,
 * ADR-0066): a workout with no road keeps the surface it always had, even on
 * a device that draws the world.
 */

const openers: Workout = {
	name: 'Openers',
	steps: [{ type: 'steady', seconds: 600, target: 0.6 }],
};

/** The ride screen's markup for `workout`. */
function screen(workout: Workout): string {
	const session = createRideSession({
		trainer: new SimulatedTrainer(),
		workout,
		ftp: 250,
	});
	return render(RidingScreen, {
		props: {
			session,
			block: null,
			workout,
			ftp: 250,
			kg: 75,
			watts: 150,
			target: 150,
			signalLost: false,
		},
	}).body;
}

describe('the world on a ride', () => {
	it('is not mounted on a ride with no road', () => {
		expect(screen(openers)).not.toContain('data-surface="docked"');
	});

	it('is mounted on a ride on a road', () => {
		const onRoad = withProfile(
			{ ...openers, road: { routeId: 'r1', fromM: 0, toM: 2000 } },
			legsRoad([1000, 0], [1000, 5]),
		);
		expect(screen(onRoad)).toContain('data-surface="docked"');
	});
});
