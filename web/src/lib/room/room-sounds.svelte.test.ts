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

import { createRoomSounds, type SoundDeps } from './room-sounds.svelte';
import type { GameState } from '$lib/protocol';

/** A quiet room; a test overrides the one thing it listens for. */
function quiet(over: Partial<SoundDeps> = {}): SoundDeps {
	return {
		phase: () => 'running',
		countdownRemaining: () => undefined,
		fault: () => null,
		sprint: () => null,
		guard: () => 'running',
		spiral: () => false,
		block: () => undefined,
		game: () => null,
		me: () => 'u1',
		...over,
	};
}

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
			createRoomSounds(quiet({ sprint: () => sprint }));
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
			createRoomSounds(quiet({ guard: () => guard }));
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

	// The block cue in a room (audit 2026-09-09): solo had it, the room did
	// not. A session starting or ending is not a block change.
	it('says a block change, and only a block change', async () => {
		heard.cues.length = 0;
		let block = $state<number | undefined>(undefined);
		const stop = $effect.root(() => {
			createRoomSounds(quiet({ block: () => block }));
		});
		await tick();
		block = 0;
		await tick();
		expect(heard.cues).toEqual([]);
		block = 1;
		await tick();
		expect(heard.cues).toEqual(['block']);
		block = undefined;
		await tick();
		expect(heard.cues).toEqual(['block']);
		stop();
	});

	it('says the spiral release the way it says auto-pause', async () => {
		heard.cues.length = 0;
		let spiral = $state(false);
		const stop = $effect.root(() => {
			createRoomSounds(quiet({ spiral: () => spiral }));
		});
		await tick();
		spiral = true;
		await tick();
		spiral = false;
		await tick();
		expect(heard.cues).toEqual(['block', 'go']);
		stop();
	});

	it('announces the session ending', async () => {
		heard.cues.length = 0;
		let phase = $state('running');
		const stop = $effect.root(() => {
			createRoomSounds(quiet({ phase: () => phase }));
		});
		await tick();
		phase = 'done';
		await tick();
		expect(heard.cues).toEqual(['fanfare']);
		stop();
	});

	// Game cues come from the shell (audit 2026-09-09), like the sprint's:
	// the panel that used to play them is drawn on the Training place only.
	it('plays a game cue on any place — Team Relay handing you the front', async () => {
		heard.cues.length = 0;
		const relay = (onFront: boolean) =>
			({
				mode: 'team-relay',
				phase: 'running',
				riders: { u1: { onFront } },
			}) as unknown as GameState;
		let game = $state<GameState | null>(relay(false));
		const stop = $effect.root(() => {
			createRoomSounds(quiet({ game: () => game }));
		});
		await tick();
		expect(heard.cues).toEqual([]);
		game = relay(true);
		await tick();
		expect(heard.cues).toEqual(['handoff']);
		stop();
	});
});
