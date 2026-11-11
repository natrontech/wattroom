import { describe, expect, it } from 'vitest';
import type { Rider, SessionRoute, StartLine } from '#lib/protocol.ts';
import type { Road } from '#lib/road/road.ts';
import type { PinnedRoad } from '#lib/workout/road-workout.ts';
import {
	WAIT_FOR_TRAINER,
	lineCue,
	roadCard,
	showsStartLine,
	startLineView,
	type LineTick,
} from './start-line';

const rider = (id: string, ftpSource: string, ftpWatts = 250): Rider => ({
	id,
	name: id[0].toUpperCase() + id.slice(1),
	role: 'member',
	ftpWatts,
	weightKg: 70,
	totalXp: 0,
	ftpSource,
});

describe('startLineView', () => {
	const roster = [
		rider('jan', 'default', 200),
		rider('kim', 'ramp', 280),
		rider('lea', 'manual'),
	];

	it('lists who stands on the line, who stands beside it and who is on the way', () => {
		const line: StartLine = {
			ready: { jan: {}, kim: { trainer: true, heartRate: true } },
			awaited: [{ id: 'ola', name: 'Ola' }],
		};
		const view = startLineView(line, roster, 'kim');
		expect(view.onLine).toEqual([
			{
				id: 'jan',
				name: 'Jan',
				you: false,
				trainer: false,
				heartRate: false,
				ftp: 200,
				ftpGuess: true,
			},
			{
				id: 'kim',
				name: 'Kim',
				you: true,
				trainer: true,
				heartRate: true,
				ftp: 280,
				ftpGuess: false,
			},
		]);
		expect(view.beside).toEqual(['Lea']);
		expect(view.awaited).toEqual(['Ola']);
		expect(view.youOn).toBe(true);
		expect(view.wait).toBeNull();
	});

	it('holds the start, saying why, until one trainer on the line is ready', () => {
		const line: StartLine = { ready: { jan: { heartRate: true } } };
		const view = startLineView(line, roster, 'lea');
		expect(view.wait).toBe(WAIT_FOR_TRAINER);
		expect(view.youOn).toBe(false);
		// A trainer beside the line is not one on it.
		expect(startLineView({ ready: {} }, roster, 'jan').wait).toBe(
			WAIT_FOR_TRAINER,
		);
	});
});

// 10 km every 20 m: a 5 % climb from km 2 to 4 (100 m, class IV) and a 20 %
// one from km 7 to 8 (200 m, class III).
const road: Road = (() => {
	const heights = Array.from({ length: 501 }, (_, i) => {
		const m = i * 20;
		const first = Math.min(Math.max(m - 2000, 0), 2000) * 0.05;
		const second = Math.min(Math.max(m - 7000, 0), 1000) * 0.2;
		return first + second;
	});
	return { length: 10_000, heights, turns: heights.slice(1).map(() => 0) };
})();
const route = (
	fromM: number,
	extra: Partial<SessionRoute> = {},
): SessionRoute => ({
	id: 'r',
	hash: 'h',
	genName: 'Road · 10.0 km · 300 m',
	fromM,
	lengthM: 10_000,
	...extra,
});
const cut = (extra: Partial<PinnedRoad> = {}): PinnedRoad => ({
	routeId: 'r',
	road,
	originM: 0,
	fromM: 0,
	toM: 10_000,
	loop: false,
	...extra,
});

describe('roadCard', () => {
	it("rides a road workout's own stretch, with the climbs on it", () => {
		const card = roadCard(
			route(0),
			cut({ toM: 5000, stepEndM: [5000] }),
			null,
			1200,
		);
		expect(card).toEqual({
			name: 'Road · 10.0 km · 300 m',
			fromKm: '0.0',
			toKm: '5.0',
			chips: ['IV'],
			seconds: 1200,
			terrainKm: null,
		});
	});

	it('says where Terrain Match starts a workout off km 0, and goes as far as the crew pace takes it', () => {
		const workout = {
			name: 'Tempo',
			steps: [{ type: 'steady' as const, seconds: 600, target: 0.75 }],
		};
		const card = roadCard(route(6000), cut(), workout, 600);
		expect(card.terrainKm).toBe('6.0');
		expect(card.fromKm).toBe('6.0');
		// Ten minutes at crew pace reaches the second climb and not the end.
		const to = Number(card.toKm);
		expect(to).toBeGreaterThan(7);
		expect(to).toBeLessThan(10);
		expect(card.chips).toEqual(['III']);
	});

	it('names no climb it has not read', () => {
		expect(roadCard(route(1200), null, null, 600)).toMatchObject({
			fromKm: '1.2',
			toKm: '10.0',
			chips: [],
			terrainKm: null,
		});
	});
});

describe('lineCue', () => {
	const open: StartLine = { ready: { jan: {} } };
	it('sounds the line opening, a rider stepping on and off, and a trainer coming ready', () => {
		expect(lineCue(null, open)).toEqual({ id: 'block' });
		expect(lineCue(open, { ready: { jan: {}, kim: {} } })).toEqual({
			id: 'join',
			shift: 5,
		});
		expect(lineCue({ ready: { jan: {}, kim: {} } }, open)).toEqual({
			id: 'leave',
			shift: 5,
		});
		expect(
			lineCue(open, { ready: { jan: {}, kim: { trainer: true } } }),
		).toEqual({ id: 'equip' });
	});
	it('stays quiet when nothing changed, and when the line goes', () => {
		expect(lineCue(open, { ready: { jan: {} } })).toBeNull();
		expect(lineCue(open, null)).toBeNull();
	});
});

describe('showsStartLine', () => {
	const onRoad = route(0);
	const onLine: LineTick = {
		startLine: { ready: { jan: {} } },
		state: { phase: 'idle', route: onRoad },
	};

	// #4504: a road session from a voice channel opens on the crew's own
	// session page, idle with its line, and nothing drew it there.
	it('shows a road session picked and not yet started', () => {
		expect(showsStartLine(onLine)).toBe(true);
		expect(showsStartLine({ ...onLine, startLine: { ready: {} } })).toBe(true);
	});

	it('hides once the count-in starts, the ride runs or the session ends', () => {
		for (const phase of ['countdown', 'running', 'paused', 'done'])
			expect(
				showsStartLine({ ...onLine, state: { phase, route: onRoad } }),
				phase,
			).toBe(false);
	});

	it('hides off a road, with no line, under a game and with no tick', () => {
		expect(showsStartLine({ ...onLine, state: { phase: 'idle' } })).toBe(false);
		expect(showsStartLine({ ...onLine, startLine: undefined })).toBe(false);
		expect(
			showsStartLine({
				...onLine,
				game: { mode: 'sprint' } as LineTick['game'],
			}),
		).toBe(false);
		expect(showsStartLine(undefined)).toBe(false);
		expect(showsStartLine(null)).toBe(false);
	});
});
