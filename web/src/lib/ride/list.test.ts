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
	it('says solo for a ride with no crew', () => {
		expect(ridePlace({})).toBe('solo');
	});
});
