// @vitest-environment happy-dom
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

// The cues are an AudioContext; only the calls matter here. Effects flush on
// tick(), not flushSync(), under vitest — the compiled module and the test
// file do not share a scheduler.
const heard = vi.hoisted(() => ({ cues: [] as string[] }));
vi.mock('$lib/sound/cues', () => ({
	play: (id: string) => void heard.cues.push(id),
	playCountdownTick: (n: number) => void heard.cues.push(`tick:${n}`),
}));
// The server's clock, held by the test.
const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock('$lib/room/server-clock', () => ({ serverNow: () => clock.now }));

import { createRoomSounds } from './room-sounds.svelte';

// The sprint and the rider's own guard announce themselves from the shell
// (#1412), so a rider on any place hears them.
describe('createRoomSounds', () => {
	it('plays the klaxon, the gun and the fanfare for a sprint on any place', async () => {
		heard.cues.length = 0;
		clock.now = 10_000;
		// Fake from the start: the interval is set the moment a sprint arms.
		vi.useFakeTimers();
		let sprint = $state<{ startsAtMs: number; endsAtMs: number } | null>(null);
		const stop = $effect.root(() => {
			createRoomSounds({
				phase: () => 'running',
				countdownRemaining: () => undefined,
				fault: () => null,
				sprint: () => sprint,
				guard: () => 'running',
			});
		});
		await tick();
		expect(heard.cues).toEqual([]);
		sprint = { startsAtMs: 13_000, endsAtMs: 28_000 };
		await tick();
		expect(heard.cues).toEqual(['klaxon']);
		clock.now = 14_000;
		vi.advanceTimersByTime(100);
		await tick();
		expect(heard.cues).toEqual(['klaxon', 'go']);
		clock.now = 29_000;
		vi.advanceTimersByTime(100);
		await tick();
		expect(heard.cues).toEqual(['klaxon', 'go', 'fanfare']);
		vi.useRealTimers();
		stop();
	});

	it('says auto-pause and the resume countdown out loud', async () => {
		heard.cues.length = 0;
		let guard = $state<'running' | 'autopaused' | 'resuming'>('running');
		const stop = $effect.root(() => {
			createRoomSounds({
				phase: () => 'running',
				countdownRemaining: () => undefined,
				fault: () => null,
				sprint: () => null,
				guard: () => guard,
			});
		});
		await tick();
		guard = 'autopaused';
		await tick();
		guard = 'resuming';
		await tick();
		guard = 'running';
		await tick();
		expect(heard.cues).toEqual(['block', 'tick:3', 'go']);
		stop();
	});
});
