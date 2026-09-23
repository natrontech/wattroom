import { describe, expect, it } from 'vitest';
import type { RailRoom } from '$lib/room/room-data';
import type { LiveCrew, LiveOccupant } from '$lib/crews-live';
import { occupantOf, othersIn, statusOf, statusOfRider } from './status';

const room = (over: Partial<RailRoom> = {}): RailRoom => ({
	name: 'MFW 5',
	slug: 'mfw-5',
	live: false,
	members: 5,
	...over,
});

describe('statusOf', () => {
	const voice = (
		id: string,
		occupants: LiveOccupant[],
	): LiveCrew['channels'][number] => ({
		id,
		kind: 'voice',
		name: id,
		occupants,
	});
	const crews: LiveCrew[] = [
		{
			id: 'c1',
			name: 'Tuesday Crew',
			role: 'member',
			channels: [
				voice('lounge', [{ id: 'u-sven', name: 'Sven Gerber' }]),
				voice('cave', [
					{ id: 'u-jan', name: 'Jan Lauber' },
					{ id: 'u-mike', name: 'Mike Frei', riding: true },
				]),
			],
		},
	];

	it('says nothing about someone the read cannot see', () => {
		expect(statusOf(crews, 'u-david')).toBe(null);
		expect(statusOf(crews, '')).toBe(null);
	});

	it('is online in a voice channel and riding on the pedals (#2517)', () => {
		expect(statusOf(crews, 'u-jan')).toBe('online');
		expect(statusOf(crews, 'u-mike')).toBe('riding');
	});

	it('is away when the rider said so, whatever the pedals (#1742)', () => {
		const away: LiveCrew[] = [
			{
				...crews[0],
				channels: [
					voice('cave', [
						{ id: 'u-mike', name: 'Mike', riding: true, away: true },
					]),
				],
			},
		];
		expect(statusOf(away, 'u-mike')).toBe('away');
	});

	it('finds them in any crew and any voice channel', () => {
		const two: LiveCrew[] = [
			crews[0],
			{
				id: 'c2',
				name: 'Other',
				role: 'owner',
				channels: [
					voice('other', [{ id: 'u-zoe', name: 'Zoe', riding: true }]),
				],
			},
		];
		expect(occupantOf(two, 'u-zoe')?.name).toBe('Zoe');
		expect(statusOf(two, 'u-zoe')).toBe('riding');
	});

	it('falls back to the friends list when the read cannot see them', () => {
		// #1434: a friend with the app open but not in a channel you can see
		// read as nothing in the DM list, while the friends panel said online.
		const friends = [
			{
				id: 'u-anna',
				name: 'Anna',
				status: 'accepted' as const,
				at: 0,
				online: true,
			},
			{ id: 'u-ben', name: 'Ben', status: 'accepted' as const, at: 0 },
			{ id: 'u-cid', name: 'Cid', status: 'pending_in' as const, at: 0 },
		];
		expect(statusOf(crews, 'u-anna', friends)).toBe('online');
		expect(statusOf(crews, 'u-ben', friends)).toBe('offline');
		// A pending request carries no presence (ADR-0012) — say nothing.
		expect(statusOf(crews, 'u-cid', friends)).toBe(null);
		expect(statusOf(crews, 'u-david', friends)).toBe(null);
		// The live read wins where it has something: riding beats "online".
		expect(
			statusOf(crews, 'u-mike', [
				{ id: 'u-mike', name: 'Mike', status: 'accepted', at: 0, online: true },
			]),
		).toBe('riding');
	});

	it('carries riding across the channel boundary (#1743)', () => {
		// ADR-0012's third state, for a channel the viewer may not enter: the
		// live read has never heard of it, so without the friends list's flag
		// this said "online" about a friend on the pedals.
		const elsewhere = [
			{
				id: 'u-anna',
				name: 'Anna',
				status: 'accepted' as const,
				at: 0,
				online: true,
				inVoice: true,
				riding: true,
			},
		];
		expect(statusOf(crews, 'u-anna', elsewhere)).toBe('riding');
	});

	it('does not answer for a namesake (#649)', () => {
		const daves: LiveCrew[] = [
			{
				...crews[0],
				channels: [voice('a', [{ id: 'u-dave-one', name: 'Dave' }])],
			},
		];
		expect(statusOf(daves, 'u-dave-one')).toBe('online');
		expect(statusOf(daves, 'u-dave-two')).toBe(null);
	});
});

describe('statusOfRider', () => {
	it('prefers what the rider said over what the trainer shows', () => {
		expect(statusOfRider({ away: true, riding: true })).toBe('away');
		expect(statusOfRider({ riding: true })).toBe('riding');
		expect(statusOfRider({ riding: false })).toBe('online');
		expect(statusOfRider({})).toBe('online');
	});
});

describe('othersIn', () => {
	it('leaves you out and keeps the others', () => {
		const r = room({
			riders: ['Jan Lauber', 'Mike Frei'],
			riderIds: ['u-jan', 'u-mike'],
		});
		expect(othersIn(r, 'u-jan')).toEqual(['Mike Frei']);
		expect(othersIn(r, 'u-mike')).toEqual(['Jan Lauber']);
		expect(othersIn(r, 'u-x')).toEqual(['Jan Lauber', 'Mike Frei']);
	});

	it('is empty when you are the only one there', () => {
		expect(
			othersIn(room({ riders: ['Jan Lauber'], riderIds: ['u-jan'] }), 'u-jan'),
		).toEqual([]);
		expect(othersIn(room(), 'u-jan')).toEqual([]);
	});
});
