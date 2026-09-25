import { describe, expect, it } from 'vitest';
import type { LiveSession } from '$lib/protocol';
import { quiet } from './crews';
import { livePulse, sessionLine, type LiveCrew } from './crew-live.svelte';

const crew: LiveCrew = {
	id: 'c1',
	name: 'Natron',
	role: 'member',
	channels: [
		{ id: 't1', kind: 'text', name: 'general', unread: 3 },
		{ id: 't2', kind: 'text', name: 'plans', unread: 2 },
		{
			id: 'v1',
			kind: 'voice',
			name: 'Thursday',
			occupants: [
				{ id: 'a', name: 'Sven', riding: true, voice: true },
				{ id: 'b', name: 'Lena', riding: true },
			],
		},
		{
			id: 'v2',
			kind: 'voice',
			name: 'Lounge',
			occupants: [{ id: 'c', name: 'Kim', voice: true }],
		},
	],
};

describe('livePulse (#1148, #2447)', () => {
	it('sums riding, voice and unread over the channels you may enter', () => {
		expect(livePulse(crew)).toEqual({ riding: 2, voice: 2, unread: 5 });
	});

	// Silent if it breaks: a crew with nothing on shows three zeroes on a
	// surface read at three metres, and nothing errors.
	it('is quiet only when nothing at all is happening', () => {
		expect(quiet(livePulse(undefined))).toBe(true);
		expect(quiet(livePulse({ ...crew, channels: [] }))).toBe(true);
		expect(quiet(livePulse(crew))).toBe(false);
	});
});

describe('sessionLine', () => {
	const session: LiveSession = {
		id: 's1',
		channel: 'v1',
		workout: 'Sweet Spot 2×20',
		phase: 'running',
		elapsed: 12 * 60 + 30,
		coach: 'a',
		coachName: 'Sven',
		riders: ['Sven', 'Lena', 'Kim', 'Ana'],
		riderIds: ['a', 'b', 'c', 'd'],
	};
	// Who is coaching is presence, and ADR-0058 lists it among what the rest
	// of the crew sees (#2635).
	it('says what, how far in, who coaches and how many', () => {
		expect(sessionLine(session)).toBe(
			'Sweet Spot 2×20 · 12 min · Sven coaching · 4',
		);
	});
	it('says starting through the countdown', () => {
		expect(sessionLine({ ...session, phase: 'countdown', elapsed: 0 })).toBe(
			'Sweet Spot 2×20 · starting · Sven coaching · 4',
		);
	});
	// A paused session's clock stands still; "12 min" read as running.
	it('says paused while it is', () => {
		expect(sessionLine({ ...session, phase: 'paused' })).toBe(
			'Sweet Spot 2×20 · paused · Sven coaching · 4',
		);
	});
});
