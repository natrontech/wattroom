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
		expect(place).toMatchObject({ m: 396.5, mps: 8, at: 5 });
		// Turned round: the climb is a descent.
		expect(place.road.heights[0]).toBe(road.heights.at(-1));
		expect(placeOnRoad(tick, null, 'me')).toBeNull();
	});

	it('rolls on from the metre’s last move, and counts dead time from the last tick', () => {
		const reckon = createDeadReckoning();
		const at = (m: number, t: number): RoadPlace => ({
			road,
			m,
			mps: 8,
			at: t,
		});
		expect(reckon(at(100, 0), 0)).toEqual({ m: 100, dead: 0 });
		// A sprint window's 4 Hz ticks repeat the whole second's metre: it keeps rolling.
		expect(reckon(at(100, 250), 250)).toEqual({ m: 102, dead: 0 });
		expect(reckon(at(100, 500), 750)).toEqual({ m: 106, dead: 0 });
		// The ticks stop: still rolling, and dead counts up.
		expect(reckon(at(100, 500), 6750)).toEqual({ m: 154, dead: 6 });
	});
});
