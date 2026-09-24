import { describe, expect, it } from 'vitest';
import type { LiveCrew } from '$lib/crews-live';
import { crewArrivals } from './crew-arrivals';

const crew = (coach: string) =>
	({
		id: 'velvet',
		name: 'Velvet',
		channels: [
			{
				id: 'track',
				kind: 'voice',
				name: 'Track',
				session: {
					id: 's1',
					channel: 'track',
					workout: 'Recovery Spin',
					phase: 'countdown',
					elapsed: 0,
					coach,
					coachName: coach,
					riders: [],
					riderIds: [],
				},
			},
		],
	}) as unknown as LiveCrew;

describe('crewArrivals — a session starting', () => {
	it.each([
		{
			name: 'is news to someone elsewhere',
			coach: 'bob',
			here: '/home',
			want: ['session-v:track'],
		},
		{
			name: 'steps aside for someone already standing in its channel',
			coach: 'bob',
			here: '/crew/velvet/v/track',
			want: [],
		},
		{
			// #2550: Start now on the Schedule opens it before the page moves.
			name: 'is never news to the rider who started it',
			coach: 'me',
			here: '/crew/velvet/schedule',
			want: [],
		},
	])('$name', ({ coach, here, want }) => {
		const got = crewArrivals([crew(coach)], new Set(), {
			here,
			me: 'me',
			looking: true,
		});
		expect(got.map((a) => a.tag)).toEqual(want);
	});
});

describe('crewArrivals — a text channel line', () => {
	// The notification wears the author's status emoji, as a DM's does (#2758).
	it("titles the line with its author's status emoji", async () => {
		const { people } = await import('$lib/people.svelte');
		people.learn([
			{
				id: 'ana',
				name: 'Ana',
				statusLine: { emoji: '\u{1F912}', text: 'Out sick' },
			},
		]);
		const chat = {
			id: 'velvet',
			name: 'Velvet',
			channels: [
				{
					id: 'lounge',
					kind: 'text',
					name: 'Lounge',
					unread: 1,
					last: { fromId: 'ana', from: 'Ana', text: 'ride?', at: 5 },
				},
			],
		} as unknown as LiveCrew;
		const got = crewArrivals([chat], new Set(), {
			here: '/home',
			me: 'me',
			looking: true,
		});
		expect(got.map((a) => a.title)).toEqual(['Ana \u{1F912} · Lounge']);
	});
});
