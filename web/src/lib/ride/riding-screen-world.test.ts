import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { SimulatedTrainer } from '$lib/ble/simulated';
import { legsRoad } from '$lib/road/fixtures';
import { createRideSession } from '$lib/workout/session.svelte';
import { withProfile } from '$lib/workout/road-workout';
import type { Workout } from '$lib/workout/types';
import RidingScreen from './RidingScreen.svelte';

vi.mock('$lib/hud/feed', () => ({ publishHud: () => {} }));
// This device draws the world: 3D turned on and a browser that can (#3084).
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
function screen(
	workout: Workout,
	extra: { onTv?: () => void; onFlag?: () => void } = {},
): string {
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
			...extra,
		},
	}).body;
}

describe('the world on a ride', () => {
	it('is not mounted on a ride with no road', () => {
		const html = screen(openers);
		expect(html).not.toContain('data-surface="docked"');
		// No world, no view switch (#3084, #4217).
		expect(html).not.toContain('data-testid="view-switch"');
	});

	it('is mounted on a ride on a road', () => {
		const onRoad = withProfile(
			{ ...openers, road: { routeId: 'r1', fromM: 0, toM: 2000 } },
			legsRoad([1000, 0], [1000, 5]),
		);
		expect(screen(onRoad)).toContain('data-surface="docked"');
	});

	it('gives slot 1 its controls as named 44 px icons with tooltips, End ride the one word (TARGETS ride-road-world 7)', () => {
		const onRoad = withProfile(
			{ ...openers, road: { routeId: 'r1', fromM: 0, toM: 2000 } },
			legsRoad([1000, 0], [1000, 5]),
		);
		const html = screen(onRoad, { onTv: () => {}, onFlag: () => {} });
		// ⚑ keeps its own kit (FlagButton): a name and the tooltip that asks.
		expect(html).toMatch(
			/<button[^>]*title="[^"]+"[^>]*aria-label="Flag a problem"/,
		);
		for (const name of ['TV mode', 'One more minute', 'Skip block'])
			expect(html).toMatch(
				new RegExp(
					`<button[^>]*class="[^"]*h-11 w-11[^"]*" aria-label="${name}" title="[^"]+"`,
				),
			);
		expect(html).toMatch(/>End ride<\/button>/);
		// 3D and Flat are one switch in the same row (#4217, ADR-0091), 3D
		// pressed while the world draws.
		expect(html).toMatch(
			/role="group" aria-label="view" data-testid="view-switch"/,
		);
		expect(html).toMatch(/aria-pressed="true"[^>]*>3D/);
		expect(html).toMatch(/aria-pressed="false"[^>]*>Flat<\/button>/);
	});
});
