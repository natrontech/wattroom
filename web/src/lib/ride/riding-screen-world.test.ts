import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { SimulatedTrainer } from '$lib/ble/simulated';
import { legsRoad } from '$lib/road/fixtures';
import { describeBlock } from '$lib/workout/block';
import { createRideSession } from '$lib/workout/session.svelte';
import { openRoad } from '$lib/workout/ridden';
import { withProfile } from '$lib/workout/road-workout';
import type { ShelfEntry } from '$lib/workout/shelf';
import type { Workout } from '$lib/workout/types';
import { createWorldView } from '$lib/world/world-view.svelte';
import { createRideShift } from '$lib/ride/ride-shift';
import { isOpenRoad } from '$lib/workout/ridden';
import RideControls from './RideControls.svelte';
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
	{
		block: withBlock,
		...extra
	}: {
		onTv?: () => void;
		onFlag?: () => void;
		shelf?: ShelfEntry[];
		onChangeWorkout?: (next: Workout | null) => void;
		/** The block the page derives, on the road as it does. */
		block?: boolean;
	} = {},
): string {
	const session = createRideSession({
		trainer: new SimulatedTrainer(),
		workout,
		ftp: 250,
	});
	const block = withBlock
		? describeBlock(
				session.info,
				session.segments,
				workout,
				250,
				[],
				{ kind: 'scenery' },
				session.road?.readout,
			)
		: null;
	return render(RidingScreen, {
		props: {
			session,
			block,
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

/** The ride's controls, which the now bar draws while the screen is up. */
function controls(
	workout: Workout,
	extra: { ontv?: () => void; onflag?: () => void; onchange?: () => void } = {},
): string {
	const session = createRideSession({
		trainer: new SimulatedTrainer(),
		workout,
		ftp: 250,
	});
	return render(RideControls, {
		props: {
			session,
			open: isOpenRoad(workout),
			shift: createRideShift(session),
			world: createWorldView(),
			drawn: true,
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
			{ road: legsRoad([1000, 0], [1000, 5]) },
		);
		expect(screen(onRoad)).toContain('data-surface="docked"');
	});

	it('gives the now bar its controls as named 44 px icons, End ride the one word (TARGETS ride-road-world 7)', () => {
		const onRoad = withProfile(
			{ ...openers, road: { routeId: 'r1', fromM: 0, toM: 2000 } },
			{ road: legsRoad([1000, 0], [1000, 5]) },
		);
		const html = controls(onRoad, { ontv: () => {}, onflag: () => {} });
		// ⚑ keeps its own kit (FlagButton). The names' tooltips are the app's
		// own (#4427), attached in the browser: tooltip.test.ts holds them.
		expect(html).toMatch(/<button[^>]*aria-label="Flag a problem"/);
		for (const name of [
			'Next camera',
			'Take the ride’s photo',
			'TV mode',
			'One more minute',
			'Skip block',
		])
			expect(html).toMatch(
				new RegExp(
					`<button[^>]*aria-label="${name}"[^>]*class="[^"]*h-11 w-11[^"]*"`,
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

	it('gives the now bar Change workout in words before End ride (#4257)', () => {
		const onRoad = withProfile(
			{ ...openers, road: { routeId: 'r1', fromM: 0, toM: 2000 } },
			{ road: legsRoad([1000, 0], [1000, 5]) },
		);
		const change = { shelf: [], onChangeWorkout: () => {} };
		expect(controls(onRoad, { onchange: () => {} })).toMatch(
			/>Change workout<\/button>(\s|<!--[^>]*-->)*<button[^>]*>End ride<\/button>/,
		);
		// Only where the page can change it: a voice channel's own ride has none.
		expect(controls(onRoad)).not.toContain('Change workout');
		// With no workout, nothing to stretch or skip.
		const none = withProfile(openRoad({ routeId: 'r1', fromM: 0, toM: 2000 }), {
			road: legsRoad([1000, 0], [1000, 5]),
		});
		const bar = controls(none, { onchange: () => {} });
		expect(bar).toContain('Change workout');
		expect(bar).not.toContain('aria-label="Skip block"');
		expect(bar).not.toContain('aria-label="One more minute"');
		// Easier and Harder lead, before ⚑ and Change workout.
		expect(controls(none, { onflag: () => {}, onchange: () => {} })).toMatch(
			/aria-label="Easier"[\s\S]*aria-label="Harder"[\s\S]*aria-label="Flag a problem"[\s\S]*>Change workout<\/button>/,
		);
		const html = screen(none, change);
		// Nor a target to trim.
		expect(html).not.toContain('raise the target by one percent');
		expect(screen(onRoad, change)).toContain('raise the target by one percent');
	});

	// #4283: no workout drew a workout's header, its eyebrow and "Free ride"
	// twice, the road line at label size and an empty column beside it.
	it('gives a ride with no workout the road’s rail, no workout clock', () => {
		const none = withProfile(openRoad({ routeId: 'r1', fromM: 0, toM: 2000 }), {
			name: 'Test loop',
			road: legsRoad([1000, 0], [1000, 5]),
		});
		const html = screen(none, {
			onTv: () => {},
			onFlag: () => {},
			shelf: [],
			onChangeWorkout: () => {},
			block: true,
		});
		const rail = html
			.slice(html.indexOf('data-testid="ride-rail"'))
			.replace(/<!--[^>]*-->/g, '');
		// No workout: the road's grade, speed and distance, no block clock or NEXT.
		expect(rail).toContain('data-testid="rail-grade"');
		expect(rail).toContain('data-cell="Speed"');
		expect(rail).not.toContain('data-testid="rail-left"');
		expect(rail).not.toContain('data-testid="rail-next"');
		// The controls are the now bar's, not the rail's.
		expect(rail).not.toContain('>End ride</button>');
	});
});
