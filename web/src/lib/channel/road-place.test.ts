import { describe, expect, it } from 'vitest';
import type { Road } from '$lib/road/road';
import { createDeadReckoning, placeOnRoad, type RoadPlace } from './road-place';

const road: Road = {
	length: 2000,
	heights: Array.from({ length: 101 }, (_, i) => 100 + 0.8 * i),
	turns: Array<number>(100).fill(0),
};

describe('your place on the session’s road (#3553)', () => {
	it('is the bunch’s metre and your offset, on the road the way it is ridden', () => {
		const tick = {
			at: 5,
			state: { phase: 'running', elapsed: 0, route: { reverse: true } },
			world: { bunchM: 400, speedMps: 8, offsets: { me: -35 } },
		} as never;
		const place = placeOnRoad(tick, { road } as never, 'me')!;
		expect(place).toMatchObject({ m: 396.5, mps: 8, at: 5, loop: false });
		// Turned round: the climb is a descent.
		expect(place.road.heights[0]).toBe(road.heights.at(-1));
		expect(placeOnRoad(tick, null, 'me')).toBeNull();
	});

	it('is your own racer’s metre in a race, which rides no bunch (#3778)', () => {
		const race = (
			at: number,
			me: object,
			game: { lineM?: number; neutralised?: boolean; phase?: string } = {},
		) =>
			placeOnRoad(
				{
					at,
					state: { phase: 'running', elapsed: 0, route: { lengthM: 2000 } },
					world: {
						bunchM: 0,
						speedMps: 0,
						racers: { me, ana: { m: 900, v: 11 } },
					},
					game: {
						phase: game.phase ?? 'running',
						race: {
							klaxonAtMs: 1000,
							lineM: game.lineM,
							neutralised: game.neutralised,
						},
					},
				} as never,
				{ road } as never,
				'me',
			);
		expect(race(2000, { m: 640, v: 9 })).toMatchObject({
			m: 640,
			mps: 9,
			at: 2000,
			loop: false,
		});
		expect(race(2000, { m: 640, v: 9 })!.road).toBe(road);
		// The neutral zone holds you at your start, rolling or not.
		expect(race(500, { m: 0, v: 9 })).toMatchObject({ m: 0, mps: 0 });
		// A hold, and a race over, step no one: their last speed is not yours.
		expect(race(2000, { m: 640, v: 9 }, { neutralised: true })).toMatchObject({
			m: 640,
			mps: 0,
		});
		expect(race(2000, { m: 640, v: 9 }, { phase: 'done' })).toMatchObject({
			mps: 0,
		});
		// Over the line you stop: the road's end, or a Wheelrace's line short of it.
		expect(race(2000, { m: 2000, v: 9 })).toMatchObject({ m: 2000, mps: 0 });
		expect(race(2000, { m: 1500, v: 9 }, { lineM: 1500 })).toMatchObject({
			mps: 0,
		});
		// A Wheelrace's road ends at its line, one road every tick.
		const wheelrace = race(2000, { m: 900, v: 9 }, { lineM: 1500 })!.road;
		expect(wheelrace).toMatchObject({ length: 1500 });
		expect(wheelrace.heights).toEqual(road.heights.slice(0, 76));
		expect(wheelrace.turns).toHaveLength(75);
		expect(race(3000, { m: 909, v: 9 }, { lineM: 1500 })!.road).toBe(wheelrace);
		// A rider the race did not line up has no place on its road.
		expect(
			placeOnRoad(
				{
					at: 2000,
					state: { route: {} },
					world: { bunchM: 0, speedMps: 0, racers: { ana: { m: 9, v: 9 } } },
				} as never,
				{ road } as never,
				'me',
			),
		).toBeNull();
	});

	it('rolls on from the metre’s last move, and counts dead time from the last tick', () => {
		const reckon = createDeadReckoning();
		const at = (m: number, t: number): RoadPlace => ({
			road,
			m,
			mps: 8,
			at: t,
			loop: false,
		});
		expect(reckon(at(100, 0), 0)).toEqual({ m: 100, dead: 0 });
		// A sprint window's 4 Hz ticks repeat the whole second's metre: it keeps rolling.
		expect(reckon(at(100, 250), 250)).toEqual({ m: 102, dead: 0 });
		expect(reckon(at(100, 500), 750)).toEqual({ m: 106, dead: 0 });
		// The ticks stop: still rolling, and dead counts up.
		expect(reckon(at(100, 500), 6750)).toEqual({ m: 154, dead: 6 });
	});
});
