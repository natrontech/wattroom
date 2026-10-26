import { describe, expect, it } from 'vitest';
import { riddenName, ridePlace, rideTitle } from './list';

describe('ridePlace (#2457)', () => {
	const crew = { id: 'c', name: 'Thursday Crew' };
	it('names the crew and the voice channel a ride was ridden in', () => {
		expect(ridePlace({ crew, channel: { id: 'v', name: 'Pain Cave' } })).toBe(
			'with Thursday Crew in Pain Cave',
		);
	});
	it('names the crew alone when the channel is gone', () => {
		expect(ridePlace({ crew, channel: null })).toBe('with Thursday Crew');
	});
	it('says solo for a ride that was not in a session', () => {
		expect(ridePlace({})).toBe('solo');
	});
	// A deleted crew sets the ride's crew and channel null; the ride was still
	// ridden with friends, and never reads "solo" for it (#2630).
	it('says in a session for a session ride whose crew is gone', () => {
		expect(ridePlace({ inSession: true })).toBe('in a session');
	});
});

describe('rideTitle (#3874)', () => {
	const road = {
		routeId: 'r1',
		name: 'Home loop',
		genName: 'Road · 7.1 km · 571 m',
	};
	it('names a free ride on your own road as its route page does', () => {
		expect(rideTitle({ workoutName: 'Free ride', road })).toBe('Home loop');
	});
	it('names a session on your road by your name for it, legs and all', () => {
		expect(rideTitle({ workoutName: 'Road · 7.1 km · 571 m', road })).toBe(
			'Home loop',
		);
		expect(
			rideTitle({ workoutName: 'Road · 7.1 km · 571 m · leg 2 of 3', road }),
		).toBe('Home loop · leg 2 of 3');
	});
	it('keeps a workout’s own name, on a road or off one', () => {
		expect(rideTitle({ workoutName: 'Sweet Spot 3×15', road })).toBe(
			'Sweet Spot 3×15',
		);
		expect(rideTitle({ workoutName: 'Free ride' })).toBe('Free ride');
	});
	it('names a free ride by the road even when the road has no generated name', () => {
		expect(
			rideTitle({ workoutName: 'Free ride', road: { ...road, genName: '' } }),
		).toBe('Home loop');
	});
	// The name the rider gave the ride (#4209) outranks the road's and the
	// workout's, while what was ridden stays what Against your best says.
	it('takes the rider’s own name first, and keeps what was ridden apart', () => {
		const titled = { workoutName: 'Free ride', road, title: 'Hill day' };
		expect(rideTitle(titled)).toBe('Hill day');
		expect(riddenName(titled)).toBe('Home loop');
		expect(rideTitle({ workoutName: 'Sweet Spot 3×15', title: '' })).toBe(
			'Sweet Spot 3×15',
		);
	});
});
