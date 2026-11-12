import { describe, expect, it } from 'vitest';
import type {
	GameState,
	SoloGameControl,
	SoloGameFrame,
} from '#lib/protocol.ts';
import { createSoloGame, gameWorkout, type GameLane } from './solo-game.svelte';
import { isOpenRoad } from '#lib/workout/ridden.ts';

/** The rider's lane, as the hub answers it: every frame sent, kept. */
function fakeLane() {
	const sent: SoloGameControl[] = [];
	const hearers = new Set<(frame: SoloGameFrame) => void>();
	const lane: GameLane = {
		sendGame: (control) => void sent.push(control),
		onGame(hear) {
			hearers.add(hear);
			return () => void hearers.delete(hear);
		},
	};
	return {
		lane,
		sent,
		hear: (frame: SoloGameFrame) => hearers.forEach((h) => h(frame)),
		listening: () => hearers.size,
	};
}

const running = (targetPct?: number): GameState => ({
	mode: 'backyard-ramp',
	phase: 'running',
	riders: { me: { targetPct } },
});

/** A game whose seconds the test ticks, riding `watts` (null: not riding). */
function rig(watts: () => number | null = () => 180) {
	const lane = fakeLane();
	let tick = () => {};
	let stopped = false;
	const game = createSoloGame({
		mode: 'backyard-ramp',
		ftp: 250,
		kg: 70,
		watts,
		lane: lane.lane,
		id: 'g1',
		every: (next) => {
			tick = next;
			return () => (stopped = true);
		},
	});
	return { game, ...lane, tick: () => tick(), stopped: () => stopped };
}

describe('a game alone (#4539)', () => {
	it('rides the ride alone: no workout, no road, unscored', () => {
		const workout = gameWorkout('watt-golf');
		expect(workout.name).toBe('Watt Golf');
		expect(workout.unscored).toBe(true);
		expect(workout.road).toBeUndefined();
		expect(isOpenRoad(workout)).toBe(true);
	});

	it('starts nothing during the count-in, and starts with the first second ridden', () => {
		let riding = false;
		const r = rig(() => (riding ? 180 : null));
		r.tick();
		r.tick();
		expect(r.sent, 'a game started during the count-in').toEqual([]);
		riding = true;
		r.tick();
		expect(r.sent).toEqual([
			{
				action: 'start',
				id: 'g1',
				mode: 'backyard-ramp',
				ftpWatts: 250,
				weightKg: 70,
			},
		]);
	});

	it('asks again until the hub answers, then sends its seconds', () => {
		const r = rig();
		r.tick();
		r.tick();
		expect(r.sent.map((s) => s.action)).toEqual(['start', 'start']);
		r.hear({ id: 'g1', state: running(0.8) });
		r.tick();
		expect(r.sent.at(-1)).toEqual({ action: 'sample', id: 'g1', watts: 180 });
	});

	it('hears its own game only', () => {
		const r = rig();
		r.hear({ id: 'another tab', state: running(0.8) });
		expect(r.game.state).toBeNull();
		r.hear({ id: 'g1', state: running(0.8) });
		expect(r.game.state?.mode).toBe('backyard-ramp');
	});

	it('asks the trainer for the ramp’s line while it runs, and nothing once over', () => {
		const r = rig();
		expect(r.game.ask).toBe(0);
		r.hear({ id: 'g1', state: running(0.85) });
		expect(r.game.ask).toBe(Math.round(0.85 * 250));
		r.hear({ id: 'g1', state: { ...running(0.85), phase: 'done' } });
		expect(r.game.ask).toBe(0);
	});

	it('says when the hub lost it, and stops sending', () => {
		const r = rig();
		r.hear({ id: 'g1', state: running(0.8) });
		r.hear({ id: 'g1', gone: true });
		expect(r.game.lost).toBe(true);
		const before = r.sent.length;
		r.tick();
		expect(r.sent.length).toBe(before);
	});

	it('ends once: the hub is told, the seconds stop, the lane is let go', () => {
		const r = rig();
		r.game.end();
		r.game.end();
		expect(r.sent).toEqual([{ action: 'end', id: 'g1' }]);
		expect(r.stopped()).toBe(true);
		expect(r.listening()).toBe(0);
	});
});
