import { describe, expect, it } from 'vitest';
import type { LiveRider } from '$lib/channel/types';
import type { FreeRoadPlace } from '$lib/protocol';
import { JUMP_M } from '$lib/world/sim';
import {
	createRoadMates,
	mateOnRoad,
	racersOnRoad,
	rideWith,
} from './road-mates';

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

describe('the other racers on a race’s road (#3778)', () => {
	const race = (
		at: number,
		racers?: Record<string, { m: number; v: number }>,
	) =>
		({
			at,
			state: { route: { lengthM: 2000 } },
			world: { bunchM: 0, speedMps: 0, racers },
			game: { phase: 'running', race: { klaxonAtMs: 1000 } },
		}) as never;

	it('is every racer but you, each at their own metre and speed', () => {
		const field = { me: { m: 640, v: 9 }, kim: { m: 900, v: 11 } };
		expect(racersOnRoad(race(2000, field), riders, 'me')).toEqual([
			{
				id: 'kim',
				name: 'Kim',
				m: 900,
				mps: 11,
				watts: 210,
				ftp: 250,
				speaking: true,
				faded: false,
			},
		]);
		// The neutral zone holds everyone, and the line holds who reached it.
		expect(racersOnRoad(race(500, field), riders, 'me')[0].mps).toBe(0);
		expect(
			racersOnRoad(race(2000, { kim: { m: 2000, v: 11 } }), riders, 'me')[0]
				.mps,
		).toBe(0);
	});

	it('fades a racer whose screen has gone, off the roster or with their socket lost', () => {
		const field = { kim: { m: 900, v: 11 }, ana: { m: 700, v: 10 } };
		const lost = [{ ...riders[1], linkLost: true }, riders[0]];
		expect(
			racersOnRoad(race(2000, field), lost, 'me').map((r) => [r.id, r.faded]),
		).toEqual([
			['kim', true],
			['ana', true],
		]);
	});

	it('is nobody outside a race', () => {
		expect(racersOnRoad(race(2000), riders, 'me')).toEqual([]);
		expect(racersOnRoad(null, riders, 'me')).toEqual([]);
	});
});

describe('Ride with <name> (#3117)', () => {
	const places = {
		me: { road: 1, m: 300 },
		kim: { road: 1, m: 1420, reverse: true },
		tom: { road: 2, m: 50 },
	};

	it('finds a mate on your road, never you, never another road', () => {
		expect(mateOnRoad(tick(1000, places), 'me', 'kim')).toEqual(places.kim);
		expect(mateOnRoad(tick(1000, places), 'me', 'tom')).toBeNull();
		expect(mateOnRoad(tick(1000, places), 'me', 'me')).toBeNull();
		expect(mateOnRoad(tick(1000, { kim: places.kim }), 'me', 'kim')).toBeNull();
	});

	it('jumps to their metre, their way, and is not offered beside them', () => {
		const jumps: [number, boolean][] = [];
		const free = (m: number) => ({
			road: { m } as never,
			rideWith: (to: number, reverse: boolean) =>
				void jumps.push([to, reverse]),
		});
		rideWith(places.kim, free(300))?.();
		expect(jumps).toEqual([[1420, true]]);
		expect(rideWith(places.kim, free(1420 - JUMP_M))).toBeNull();
		expect(rideWith(places.kim, { road: null, rideWith: () => {} })).toBeNull();
		expect(rideWith(places.kim, undefined)).toBeNull();
	});
});
