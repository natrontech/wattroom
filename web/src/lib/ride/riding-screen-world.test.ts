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

	it('gives slot 1 its controls as named 44 px icons with tooltips, End ride the one word (TARGETS ride-road-world 7)', () => {
		const onRoad = withProfile(
			{ ...openers, road: { routeId: 'r1', fromM: 0, toM: 2000 } },
			{ road: legsRoad([1000, 0], [1000, 5]) },
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

	it('gives slot 1 Change workout in words before End ride (#4257)', () => {
		const onRoad = withProfile(
			{ ...openers, road: { routeId: 'r1', fromM: 0, toM: 2000 } },
			{ road: legsRoad([1000, 0], [1000, 5]) },
		);
		const change = { shelf: [], onChangeWorkout: () => {} };
		expect(screen(onRoad, change)).toMatch(
			/>Change workout<\/button>(\s|<!--[^>]*-->)*<button[^>]*>End ride<\/button>/,
		);
		// Only where the page can change it: a voice channel's own ride has none.
		expect(screen(onRoad)).not.toContain('Change workout');
		// With no workout, nothing to stretch or skip.
		const none = withProfile(openRoad({ routeId: 'r1', fromM: 0, toM: 2000 }), {
			road: legsRoad([1000, 0], [1000, 5]),
		});
		const html = screen(none, change);
		expect(html).toContain('Change workout');
		expect(html).not.toContain('aria-label="Skip block"');
		expect(html).not.toContain('aria-label="One more minute"');
		// Nor a target to trim.
		expect(html).not.toContain('raise the target by one percent');
		expect(screen(onRoad, change)).toContain('raise the target by one percent');
	});

	// #4283: no workout drew a workout's header, its eyebrow and "Free ride"
	// twice, the road line at label size and an empty column beside it.
	it('gives a ride with no workout the free ride’s slot 1 (TARGETS ride-free-road 3, 7)', () => {
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
		const band = html
			.slice(html.indexOf('data-testid="ride-band"'), html.indexOf('</header>'))
			.replace(/<!--[^>]*-->/g, '');
		// The road named once, in the label.
		expect(band).toMatch(
			/data-testid="ride-context"[^>]*>\s*Free ride · Test loop\s*</,
		);
		expect(band.match(/Free ride/g)).toHaveLength(1);
		// The road line at display size, then the chip and the time with m climbed.
		expect(band).toMatch(/data-testid="block-road" class="[^"]*text-4xl/);
		expect(band).toMatch(/data-testid="trainer-chip"[^>]*>SIM · you feel/);
		expect(band).toMatch(/data-testid="ride-clock"[^>]*>0:00 · 0 m climbed</);
		// Easier and Harder in the controls' row, before ⚑ and Change workout.
		expect(band).toMatch(
			/>Easier<\/button>[\s\S]*>Harder<\/button>[\s\S]*aria-label="Flag a problem"[\s\S]*>Change workout<\/button>/,
		);
		// The controls on the label's row, above the road line (the box
		// table's "eyebrow or status line 24 with the controls 44", v2-ride).
		expect(band).toMatch(
			/data-testid="ride-context"[\s\S]*>End ride<\/button>[\s\S]*data-testid="block-road"/,
		);
		// No workout's header: no ridden clock, no column for a strip or NEXT.
		expect(band).not.toContain('aria-label="ridden"');
		expect(band).not.toContain('w-88');
	});
});
