import { describe, expect, it } from 'vitest';
import type { LiveRider } from '$lib/channel/types';
import type { FreeRoadPlace } from '$lib/protocol';
import { createRoadMates } from './road-mates';

const rider = (id: string, name: string, watts = 0) =>
	({ id, name, watts, ftp: 250, speaking: id === 'kim' }) as LiveRider;
const riders = [
	rider('me', 'Me'),
	rider('kim', 'Kim', 210),
	rider('tom', 'Tom'),
];
const tick = (at: number, freeRoads?: Record<string, FreeRoadPlace>) => ({
	at,
	freeRoads,
});

describe('your channel-mates on your road (#3117)', () => {
	it('is whoever the tick puts on your road, never you, never another road', () => {
		const mates = createRoadMates();
		const got = mates(
			tick(1000, {
				me: { road: 1, m: 300 },
				kim: { road: 1, m: 420 },
				tom: { road: 2, m: 50 },
			}),
			riders,
			'me',
		);
		expect(got).toEqual([
			{
				id: 'kim',
				name: 'Kim',
				m: 420,
				mps: 0,
				watts: 210,
				ftp: 250,
				speaking: true,
			},
		]);
	});

	it('is nobody while the hub has you on no shared road', () => {
		const mates = createRoadMates();
		expect(
			mates(tick(1000, { kim: { road: 1, m: 420 } }), riders, 'me'),
		).toEqual([]);
		expect(mates(tick(2000), riders, 'me')).toEqual([]);
		expect(mates(null, riders, 'me')).toEqual([]);
	});

	it('reads a mate’s speed off their last two places, and holds it still once they stop', () => {
		const mates = createRoadMates();
		const at = (t: number, kim: number) =>
			mates(
				tick(t, { me: { road: 1, m: 0 }, kim: { road: 1, m: kim } }),
				riders,
				'me',
			)[0].mps;
		expect(at(1000, 100)).toBe(0);
		expect(at(2000, 108)).toBeCloseTo(8);
		// The same tick read again is the same answer.
		expect(at(2000, 108)).toBeCloseTo(8);
		expect(at(3000, 108)).toBeCloseTo(8);
		expect(at(5000, 108)).toBe(0);
		// A lap back down the road counts down.
		expect(at(6000, 102)).toBeCloseTo(-6 / 4);
	});
});
