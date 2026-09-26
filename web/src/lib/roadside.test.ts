import { describe, expect, it } from 'vitest';
import { BELL } from '$lib/icons';
import type { GameState } from '$lib/protocol';
import { CUES } from '$lib/sound/cue-catalogue';
import {
	atRoadside,
	bottleArrival,
	cheerCues,
	effortOf,
	inRecoveryValley,
} from './roadside';

describe('the cowbell (#3022)', () => {
	// SPEC's roadside: the TR-808's two square voices through one bandpass.
	it('is two square voices, 540 and 800 Hz, rung through a bandpass', () => {
		const { voices } = CUES.cowbell;
		expect(voices.map((v) => [v.type, v.freq])).toEqual([
			['square', 540],
			['square', 800],
		]);
		for (const voice of voices) {
			expect(voice.filter?.type).toBe('bandpass');
			expect(voice.filter?.from).toBeGreaterThan(800);
			expect(voice.filter?.from).toBeLessThan(1000);
			// A struck bell, not a drone: over well inside half a second.
			expect(voice.at + voice.dur).toBeLessThanOrEqual(0.4);
		}
	});

	it('rings for the bell key and never for a reaction', () => {
		expect(cheerCues([{ emoji: BELL, from: 'Ana' }])).toEqual([
			{ id: 'cowbell', semitones: 0 },
		]);
		expect(cheerCues([{ emoji: 'flame', from: 'Ana' }])).toEqual([
			{ id: 'cheer', semitones: 0 },
		]);
	});

	it('rings once a tick, and leaves the crowd pitch to the other cheers', () => {
		const tick = [
			{ emoji: BELL, from: 'Ana' },
			{ emoji: BELL, from: 'Ben' },
			{ emoji: 'flame', from: 'Cy' },
			{ emoji: 'skull', from: 'Di' },
		];
		expect(cheerCues(tick)).toEqual([
			{ id: 'cowbell', semitones: 0 },
			{ id: 'cheer', semitones: 2 },
		]);
		expect(cheerCues([])).toEqual([]);
	});
});

describe('at the roadside (#3022)', () => {
	const game = (mode: string, eliminated: boolean, phase = 'running') =>
		({
			mode,
			phase,
			riders: { me: { eliminated }, sven: {} },
		}) as unknown as GameState;

	it.each(['backyard-ramp', 'floor-is-lava'])(
		'is where %s puts a rider it eliminates',
		(mode) => {
			expect(atRoadside(game(mode, true), 'me')).toBe(true);
			expect(atRoadside(game(mode, false), 'me')).toBe(false);
		},
	);

	it('ends with the game, and needs somebody to be', () => {
		expect(atRoadside(game('backyard-ramp', true, 'done'), 'me')).toBe(false);
		expect(atRoadside(game('backyard-ramp', true), undefined)).toBe(false);
		expect(atRoadside(undefined, 'me')).toBe(false);
	});
});

describe('a recovery valley (#3022)', () => {
	const easy = { targetWatts: 0, ftp: 250, calledZone: 0, sprinting: false };

	it('is a target in Z1, active recovery, and nothing above it', () => {
		expect(inRecoveryValley({ ...easy, targetWatts: 137 })).toBe(true); // 55 %
		expect(inRecoveryValley({ ...easy, targetWatts: 140 })).toBe(false); // 56 %
		expect(inRecoveryValley({ ...easy, targetWatts: 300 })).toBe(false);
	});

	it('is any moment the ride asks nothing — paused, stopped, not riding', () => {
		expect(inRecoveryValley(easy)).toBe(true);
	});

	it('is never a sprint, whose target reads as nothing', () => {
		expect(inRecoveryValley({ ...easy, sprinting: true })).toBe(false);
	});

	it('follows the zone a game calls, for a rider still in it', () => {
		const lava = (calledZone: number, eliminated = false) =>
			({
				mode: 'floor-is-lava',
				phase: 'running',
				calledZone,
				riders: { me: { eliminated } },
			}) as unknown as GameState;
		const ride = { targetWatts: 0, ftp: 250, sprinting: false };
		expect(inRecoveryValley(effortOf(ride, lava(4), 'me'))).toBe(false);
		expect(inRecoveryValley(effortOf(ride, lava(1), 'me'))).toBe(true);
		// Out of the game, the zone is everyone else's.
		expect(inRecoveryValley(effortOf(ride, lava(4, true), 'me'))).toBe(true);
	});
});

describe('a bottle popping (#3022)', () => {
	it('says who handed it up and leads back to the channel', () => {
		expect(
			bottleArrival(
				{ fromId: 'ana', from: 'Ana', at: 5000 },
				{ href: '/crew/c/v/lounge' },
			),
		).toMatchObject({
			kind: 'bottle',
			tag: 'bottle-ana',
			at: 5000,
			title: 'Ana handed you a bottle',
			href: '/crew/c/v/lounge',
			reading: false,
		});
	});
});
