import { describe, expect, it } from 'vitest';
import { BELL } from '$lib/icons';
import type { GameState } from '$lib/protocol';
import { CUES } from '$lib/sound/cue-catalogue';
import type { LiveRider } from '$lib/channel/types';
import {
	atRoadside,
	bottleArrival,
	bottleFor,
	cheerCues,
	effortOf,
	inRecoveryValley,
	type Effort,
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
	const easy: Effort = {
		targetWatts: 0,
		ftp: 250,
		calledZone: 0,
		sprinting: false,
		unreadable: false,
	};

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

describe('a recovery valley under each game mode (#3022)', () => {
	// The trainer asks nothing: the only word on effort is the game's. Every
	// mode is taken as the server sends it (hub/mode_*.go).
	const free = { targetWatts: 0, ftp: 250, sprinting: false };
	const running = (mode: string, over: Partial<GameState> = {}) =>
		({ mode, phase: 'running', riders: {}, ...over }) as GameState;
	const valley = (game: GameState, ride = free) =>
		inRecoveryValley(effortOf(ride, game, 'me'));

	// Watt Golf's holes are 60–110 % of FTP and live only in linePct: the
	// meter is hidden, the trainer holds nothing, and a bottle mid-hole is a
	// hand in the rider's face while they chase a number blind.
	it('is never a Watt Golf hole, whose target is the line', () => {
		const golf = (linePct: number) =>
			running('watt-golf', { linePct, riders: { me: { score: 12 } } });
		expect(valley(golf(0.6))).toBe(false);
		expect(valley(golf(1.1))).toBe(false);
	});

	// The window rides the game from the klaxon to its end — not tick.sprint,
	// which only the coach's own sprint sets.
	it('is never a Sprint Roulette window, and is between them', () => {
		const window = running('sprint-roulette', {
			roundStartsAtMs: 5_000,
			roundEndsAtMs: 17_000,
		});
		expect(valley(window)).toBe(false);
		expect(valley(running('sprint-roulette'))).toBe(true);
	});

	// A Points Race's sprints come roulette-style but never reach the tick.
	it('is never a Points Race, whose sprints come unannounced', () => {
		expect(valley(running('points-race'))).toBe(false);
		expect(valley({ ...running('points-race'), phase: 'done' })).toBe(true);
	});

	it('follows the rider’s own target in the ramps and the relay', () => {
		const target = (mode: string, targetPct: number, eliminated = false) =>
			running(mode, { riders: { me: { targetPct, eliminated } } });
		expect(valley(target('backyard-ramp', 0.8))).toBe(false);
		expect(valley(target('collective-ramp', 0.75))).toBe(false);
		expect(valley(target('team-relay', 1.1))).toBe(false); // on the front
		expect(valley(target('team-relay', 0.55))).toBe(true); // on a wheel
		// Put out: spinning easy at 50 %, at the roadside themselves.
		expect(valley(target('backyard-ramp', 0.5, true))).toBe(true);
	});

	// The ride hands over whole watts: 55 % of 250 W arrives as 138 W, which
	// is 55.2 % — Z1's top is 55 %, so the rounding alone must not make it Z2.
	it('reads a 55 % block as a valley at every FTP, whole watts and all', () => {
		for (let ftp = 100; ftp <= 400; ftp++) {
			const ride = {
				targetWatts: Math.round(0.55 * ftp),
				ftp,
				sprinting: false,
			};
			const wheel = running('team-relay', {
				riders: { me: { targetPct: 0.55 } },
			});
			expect(valley(wheel, ride), `relay wheel at FTP ${ftp}`).toBe(true);
			expect(
				inRecoveryValley(effortOf(ride, undefined, 'me')),
				`55 % block at FTP ${ftp}`,
			).toBe(true);
		}
		const z2 = {
			targetWatts: Math.round(0.56 * 250),
			ftp: 250,
			sprinting: false,
		};
		expect(inRecoveryValley(effortOf(z2, undefined, 'me'))).toBe(false);
	});

	// A stopped rider's trainer is released to 0, and the ramp still asks.
	it('is not a ramp round a stopped rider is about to be put out of', () => {
		const ramp = running('backyard-ramp', {
			riders: { me: { targetPct: 0.85 } },
		});
		expect(valley(ramp)).toBe(false);
	});

	// The server may learn an eighth mode before this client does.
	it('is never a mode this screen does not know, while it runs', () => {
		expect(valley(running('king-of-the-mountain'))).toBe(false);
		expect(valley({ ...running('king-of-the-mountain'), phase: 'done' })).toBe(
			true,
		);
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

describe('bottleFor (#3022)', () => {
	const rider = (id: string, over: Partial<LiveRider> = {}): LiveRider =>
		({ id, name: id, watts: 0, ftp: 200, you: false, ...over }) as LiveRider;

	it('hands it to the watched rider in the session, never to you', () => {
		const riders = [
			rider('me', { you: true, inSession: true, watts: 400 }),
			rider('a', { inSession: true, watts: 150 }),
			rider('free', { watts: 390 }), // pedalling beside the session
		];
		expect(bottleFor(riders, null)?.id).toBe('a');
		expect(bottleFor(riders, 'me')?.id).toBe('a');
		expect(bottleFor(riders, 'free')?.id).toBe('a');
	});

	it('has nobody to hand it to when nobody rides the session', () => {
		expect(bottleFor([rider('me', { you: true })], null)).toBeNull();
	});
});
