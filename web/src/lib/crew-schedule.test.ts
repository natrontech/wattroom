import { describe, expect, it } from 'vitest';
import { crewCalendarLink, mayRearrange, planPlace } from './crew-schedule';

describe('crew schedule (#2452)', () => {
	it('says where a plan runs, or that it names no channel yet', () => {
		expect(planPlace({ channelName: 'Pain Cave' })).toBe('in Pain Cave');
		expect(planPlace({})).toBe('no voice channel yet');
	});

	// The matrix's "move / cancel": a member their own, the owner and admins
	// any plan — the page must not offer a button the server refuses.
	it('offers move and cancel to whoever the server lets', () => {
		expect(mayRearrange({ mine: true }, 'member')).toBe(true);
		expect(mayRearrange({}, 'member')).toBe(false);
		expect(mayRearrange({}, 'admin')).toBe(true);
		expect(mayRearrange({}, 'owner')).toBe(true);
	});

	it('builds the feed URL a calendar app subscribes to', () => {
		expect(crewCalendarLink('https://wattroom.ch', 'c1', 'tok')).toBe(
			'https://wattroom.ch/api/crews/c1/calendar/tok.ics',
		);
	});
});
