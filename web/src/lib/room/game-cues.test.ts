import { describe, expect, it } from 'vitest';
import { gameCues, golfMoment } from '$lib/room/game-cues';
import type { GameState } from '$lib/protocol';

const ME = 'me';

const state = (over: Partial<GameState> = {}): GameState => ({
	mode: 'backyard-ramp',
	phase: 'running',
	riders: {},
	...over,
});

const ids = (cues: { id: string; shift?: number }[]) => cues.map((c) => c.id);

describe('gameCues', () => {
	it('says nothing on the first look — a game in progress is not a change', () => {
		expect(gameCues(null, state({ round: 4, calledZone: 3 }), ME)).toEqual([]);
	});

	it('says nothing when the mode changed under it', () => {
		const before = state({ mode: 'floor-is-lava', calledZone: 2 });
		const now = state({ mode: 'watt-golf', calledZone: 5 });
		expect(gameCues(before, now, ME)).toEqual([]);
	});

	it('announces a rider knocked out — once, however many went together', () => {
		const before = state({ riders: { a: {}, b: {}, c: {} } });
		const now = state({
			riders: { a: { eliminated: true }, b: { eliminated: true }, c: {} },
		});
		expect(ids(gameCues(before, now, ME))).toEqual(['elimination']);
	});

	it('does not re-announce a rider who was already out', () => {
		const out = state({ riders: { a: { eliminated: true } } });
		expect(gameCues(out, out, ME)).toEqual([]);
	});

	describe('a life burning', () => {
		it('is your own business, pitched above being knocked out', () => {
			const before = state({ riders: { [ME]: { lives: 3 } } });
			const now = state({ riders: { [ME]: { lives: 2 } } });
			expect(gameCues(before, now, ME)).toEqual([
				{ id: 'elimination', shift: 12 },
			]);
		});

		it('stays quiet for everyone else — eight riders would be noise', () => {
			const before = state({ riders: { other: { lives: 3 } } });
			const now = state({ riders: { other: { lives: 2 } } });
			expect(gameCues(before, now, ME)).toEqual([]);
		});

		it('does not double up with being knocked out on the last one', () => {
			const before = state({ riders: { [ME]: { lives: 1 } } });
			const now = state({
				riders: { [ME]: { lives: 0, eliminated: true } },
			});
			expect(ids(gameCues(before, now, ME))).toEqual(['elimination']);
		});
	});

	describe('the relay handover', () => {
		it('fires when the front comes to you', () => {
			const before = state({ mode: 'team-relay', riders: { [ME]: {} } });
			const now = state({
				mode: 'team-relay',
				riders: { [ME]: { onFront: true } },
			});
			expect(ids(gameCues(before, now, ME))).toEqual(['handoff']);
		});

		it('does not fire while you stay on front', () => {
			const on = state({
				mode: 'team-relay',
				riders: { [ME]: { onFront: true } },
			});
			expect(gameCues(on, on, ME)).toEqual([]);
		});

		it('does not fire when somebody else takes it', () => {
			const before = state({ mode: 'team-relay', riders: { a: {} } });
			const now = state({
				mode: 'team-relay',
				riders: { a: { onFront: true } },
			});
			expect(gameCues(before, now, ME)).toEqual([]);
		});
	});

	it('announces a called zone moving — 5 s before it costs a life', () => {
		const before = state({ mode: 'floor-is-lava', calledZone: 2 });
		const now = state({ mode: 'floor-is-lava', calledZone: 4 });
		expect(ids(gameCues(before, now, ME))).toEqual(['block']);
	});

	describe('a ramp round', () => {
		it('announces the line climbing', () => {
			expect(
				ids(gameCues(state({ round: 1 }), state({ round: 2 }), ME)),
			).toEqual(['block']);
		});

		it('leaves Watt Golf alone — its run-in already counts the hole in', () => {
			const before = state({ mode: 'watt-golf', round: 1 });
			const now = state({ mode: 'watt-golf', round: 2 });
			expect(gameCues(before, now, ME)).toEqual([]);
		});

		it("sounds Sprint Roulette's klaxon when a window appears, and only then (#1587)", () => {
			const quiet = state({ mode: 'sprint-roulette', round: 1 });
			const armed = state({
				mode: 'sprint-roulette',
				round: 2,
				roundEndsAtMs: 20_000,
			});
			expect(ids(gameCues(quiet, armed, ME))).toEqual(['klaxon']);
			// The window is still up: no second klaxon on the next tick.
			expect(gameCues(armed, armed, ME)).toEqual([]);
			// The round number alone is not the klaxon.
			expect(
				gameCues(quiet, state({ mode: 'sprint-roulette', round: 2 }), ME),
			).toEqual([]);
		});
	});

	describe('the podium', () => {
		const podium = [{ riderId: 'a', name: 'Ada', wkg: 4, watts: 300 }];

		it('sounds once, when the game reaches done', () => {
			const before = state({ phase: 'running' });
			const now = state({ phase: 'done', podium });
			expect(ids(gameCues(before, now, ME))).toEqual(['fanfare']);
		});

		it('does not repeat while the game sits on done', () => {
			const done = state({ phase: 'done', podium });
			expect(gameCues(done, done, ME)).toEqual([]);
		});

		it('stays quiet for a game that ended with no podium', () => {
			const before = state({ phase: 'running' });
			const now = state({ phase: 'done' });
			expect(gameCues(before, now, ME)).toEqual([]);
		});
	});
});

describe('golfMoment', () => {
	const hole = (over: Partial<GameState> = {}) =>
		state({
			mode: 'watt-golf',
			meterHidden: true,
			roundEndsAtMs: 20_000,
			...over,
		});

	it('counts the hole in over the last three seconds, then fires the gun', () => {
		// One second per step through the whole run-in, as the panel sees it.
		const heard: string[] = [];
		for (let t = 0; t <= 21_000; t += 1000) {
			const moment = golfMoment(hole(), t);
			if (!moment) continue;
			heard.push('go' in moment ? 'go' : `tick${moment.tick}`);
		}
		expect(heard).toEqual(['tick3', 'tick2', 'tick1', 'go']);
	});

	it('says nothing across the twenty seconds before that', () => {
		expect(golfMoment(hole(), 0)).toBeNull();
		expect(golfMoment(hole(), 16_000)).toBeNull();
	});

	it('still fires the gun just after the hole opens', () => {
		expect(golfMoment(hole(), 20_001)).toEqual({ go: true });
	});

	it('stays quiet rather than firing the gun late into an open hole', () => {
		expect(golfMoment(hole(), 21_001)).toBeNull();
		expect(golfMoment(hole(), 25_000)).toBeNull();
	});

	it('says nothing in another mode, or with the meter showing', () => {
		expect(golfMoment(hole({ mode: 'backyard-ramp' }), 19_000)).toBeNull();
		expect(golfMoment(hole({ meterHidden: false }), 19_000)).toBeNull();
		expect(golfMoment(hole({ phase: 'done' }), 19_000)).toBeNull();
	});
});
