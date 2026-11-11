// @vitest-environment happy-dom
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

// The cues are an AudioContext; only the calls matter here. Effects flush on
// tick(), not flushSync(), under vitest — the compiled module and the test
// file do not share a scheduler.
const heard = vi.hoisted(() => ({ cues: [] as string[] }));
vi.mock('#lib/sound/cues.ts', () => ({
	PAN_LIMIT: 0.8,
	play: (id: string, at?: { pan?: number }) =>
		void heard.cues.push(at?.pan ? `${id}@${at.pan}` : id),
	playCountdownTick: (n: number) => void heard.cues.push(`tick:${n}`),
}));
// The server's clock, held by the test.
const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock('#lib/server-clock.ts', () => ({ serverNow: () => clock.now }));

import { createSessionSounds, type SoundDeps } from './session-sounds.svelte';
import type { GameState, StartLine } from '#lib/protocol.ts';
import type { RaceReadout } from '#lib/race/race-view.ts';

/** A quiet session; a test overrides the one thing it listens for. */
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
		coach: () => undefined,
		race: () => null,
		startLine: () => undefined,
		...over,
	};
}

// The sprint and the rider's own guard announce themselves from the shell
// (#1412), so a rider on any place hears them.
describe('createSessionSounds', () => {
	// The wheel (#3265): in and out of shelter, and a rider going by close,
	// on the side they went by. Over the line the wheel lets go silently.
	it('says the wheel and who goes by', async () => {
		heard.cues.length = 0;
		const at = (t: number, over: Partial<RaceReadout> = {}): RaceReadout => ({
			at: t * 1000,
			phase: 'racing',
			par: 0,
			category: 'C',
			place: 1,
			of: 2,
			toLine: 1000,
			shelter: 0,
			gaps: { b: 3 },
			inWheel: false,
			...over,
		});
		let race = $state<RaceReadout | null>(at(0));
		const stop = $effect.root(() => {
			createSessionSounds(quiet({ race: () => race }));
		});
		await tick();
		race = at(1, { inWheel: true });
		await tick();
		expect(heard.cues).toEqual(['wheel-in']);
		// You passed b within a wheel's reach: heard on your right.
		race = at(2, { inWheel: true, gaps: { b: -2 } });
		await tick();
		expect(heard.cues).toEqual(['wheel-in', 'whoosh@0.8']);
		race = at(3, { inWheel: false, gaps: { b: -2 } });
		await tick();
		expect(heard.cues).toEqual(['wheel-in', 'whoosh@0.8', 'wheel-out']);
		race = at(4, { inWheel: true, gaps: { b: -2 } });
		await tick();
		race = at(5, { inWheel: false, phase: 'finished', gaps: { b: 1 } });
		await tick();
		expect(heard.cues).toEqual([
			'wheel-in',
			'whoosh@0.8',
			'wheel-out',
			'wheel-in',
			// b came by you within reach: on your left.
			'whoosh@-0.8',
		]);
		stop();
	});

	it('plays the klaxon, the gun and the fanfare for a sprint on any place', async () => {
		heard.cues.length = 0;
		clock.now = 10_000;
		// Fake from the start: the interval is set the moment a sprint arms.
		vi.useFakeTimers();
		let sprint = $state<{ startsAtMs: number; endsAtMs: number } | null>(null);
		const stop = $effect.root(() => {
			createSessionSounds(quiet({ sprint: () => sprint }));
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

	// The start line (#3228): what was already there when the rider looked
	// is not news; the line opening and a rider stepping on it are.
	it('says the start line changing, never the line it walked in on', async () => {
		heard.cues.length = 0;
		let line = $state<StartLine | null>({ ready: { jan: {} } });
		const stop = $effect.root(() => {
			createSessionSounds(quiet({ startLine: () => line }));
		});
		await tick();
		expect(heard.cues).toEqual([]);
		line = { ready: { jan: {}, kim: {} } };
		await tick();
		line = null;
		await tick();
		line = { ready: { jan: {} } };
		await tick();
		expect(heard.cues).toEqual(['join', 'block']);
		stop();
	});

	it('says auto-pause and the resume countdown out loud', async () => {
		heard.cues.length = 0;
		let guard = $state<'running' | 'autopaused' | 'resuming'>('running');
		const stop = $effect.root(() => {
			createSessionSounds(quiet({ guard: () => guard }));
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

	// The block cue in a session (audit 2026-09-09): solo had it, the
	// session did not. A session starting or ending is not a block change.
	it('says a block change, and only a block change', async () => {
		heard.cues.length = 0;
		let block = $state<number | undefined>(undefined);
		const stop = $effect.root(() => {
			createSessionSounds(quiet({ block: () => block }));
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
			createSessionSounds(quiet({ spiral: () => spiral }));
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
			createSessionSounds(quiet({ phase: () => phase }));
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
			createSessionSounds(quiet({ game: () => game }));
		});
		await tick();
		expect(heard.cues).toEqual([]);
		game = relay(true);
		await tick();
		expect(heard.cues).toEqual(['handoff']);
		stop();
	});
	it('hears the session become yours, and only from somebody else (#2636)', async () => {
		heard.cues.length = 0;
		let coach = $state<string | undefined>(undefined);
		const stop = $effect.root(() => {
			createSessionSounds(quiet({ coach: () => coach }));
		});
		await tick();
		coach = 'u1'; // you opened it yourself: your own tap
		await tick();
		expect(heard.cues).toEqual([]);
		coach = 'u2'; // you handed it on
		await tick();
		expect(heard.cues).toEqual([]);
		coach = 'u1'; // and it came back
		await tick();
		expect(heard.cues).toEqual(['handoff']);
		stop();
	});
});
