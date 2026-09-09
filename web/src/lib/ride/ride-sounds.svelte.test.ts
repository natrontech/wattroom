// @vitest-environment happy-dom
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

const heard = vi.hoisted(() => ({ cues: [] as string[] }));
vi.mock('$lib/sound/cues', () => ({
	play: (id: string) => void heard.cues.push(id),
	playCountdownTick: (n: number) => void heard.cues.push(`tick:${n}`),
}));
vi.mock('$lib/room/server-clock', () => ({ serverNow: () => 0 }));

import {
	createRideSounds,
	guardOfRide,
	type RideSoundDeps,
} from './ride-sounds.svelte';

function quiet(over: Partial<RideSoundDeps> = {}): RideSoundDeps {
	return {
		fault: () => null,
		sprint: () => null,
		guard: () => 'running',
		spiral: () => false,
		block: () => undefined,
		...over,
	};
}

// The room's cues, heard by a rider alone (#1792): the shared effects are
// covered through createRoomSounds; this is the solo composition's own —
// the end, and the guard as the session's state names it.
describe('createRideSounds', () => {
	it('says the end of a ride once', async () => {
		heard.cues.length = 0;
		let over = $state(false);
		const stop = $effect.root(() => {
			createRideSounds(quiet({ ended: () => over }));
		});
		await tick();
		expect(heard.cues).toEqual([]);
		over = true;
		await tick();
		over = true;
		await tick();
		expect(heard.cues).toEqual(['fanfare']);
		stop();
	});

	it('hears auto-pause and the resume count from the session state', async () => {
		heard.cues.length = 0;
		let state = $state<'running' | 'autopaused' | 'resuming' | 'done'>(
			'running',
		);
		const stop = $effect.root(() => {
			createRideSounds(quiet({ guard: () => guardOfRide(state) }));
		});
		await tick();
		state = 'autopaused';
		await tick();
		state = 'resuming';
		await tick();
		state = 'running';
		await tick();
		expect(heard.cues).toEqual(['block', 'tick:3', 'go']);
		// The end is not a guard phase: nothing is said for it here.
		state = 'done';
		await tick();
		expect(heard.cues).toEqual(['block', 'tick:3', 'go']);
		stop();
	});
});
