import { describe, expect, it } from 'vitest';
import { ridePlace } from './list';

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
		expect(ridePlace({ room: true })).toBe('in a session');
	});
});
