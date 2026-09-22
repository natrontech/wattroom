import { describe, expect, it } from 'vitest';
import type { ApiResult } from '$lib/api';
import type { CrewChannel } from '$lib/channels';
import type { Crew, CrewMembers } from '$lib/crew';
import type { Announcement } from '$lib/room/room-data';
import { liveRoleOf, voiceChannelData } from './voice-channel';

const crew = {
	ok: true,
	data: { id: 'c1', role: 'member' },
} as ApiResult<Crew>;
const members = { ok: true, data: {} } as ApiResult<CrewMembers>;
const none = { ok: true, data: undefined } as ApiResult<
	Announcement | undefined
>;
const listing = (...channels: Partial<CrewChannel>[]) =>
	({ ok: true, data: { channels } }) as ApiResult<{ channels: CrewChannel[] }>;

describe('a voice channel page’s data (#2449)', () => {
	it('finds the voice channel it was asked for', () => {
		const got = voiceChannelData(
			'v1',
			crew,
			listing({ id: 'v1', kind: 'voice', name: 'Spin' }),
			members,
			none,
		);
		expect(got.channel?.name).toBe('Spin');
		expect(got.error).toBeNull();
	});

	// The list holds only channels the caller may enter, so a private one
	// that does not name them is absent — and reads exactly like none.
	it('answers not_found for a channel the caller may not enter', () => {
		const got = voiceChannelData('secret', crew, listing(), members, none);
		expect(got.channel).toBeNull();
		expect(got.errorCode).toBe('not_found');
	});

	it('answers not_found for a text channel addressed as voice', () => {
		const got = voiceChannelData(
			't1',
			crew,
			listing({ id: 't1', kind: 'text', name: 'general' }),
			members,
			none,
		);
		expect(got.errorCode).toBe('not_found');
	});

	it('passes a crew refusal through as the page’s error', () => {
		const refused = {
			ok: false,
			error: { error: 'not_found', message: 'No crew lives here.' },
		} as ApiResult<Crew>;
		const got = voiceChannelData('v1', refused, listing(), members, none);
		expect(got.error).toBe('No crew lives here.');
		expect(got.crew).toBeNull();
	});
});

describe('liveRoleOf', () => {
	// channels.LiveRole's mapping: the page agrees with the hub's roster.
	it('keeps the owner and admins, and makes anyone else a member', () => {
		expect(liveRoleOf('owner')).toBe('owner');
		expect(liveRoleOf('admin')).toBe('admin');
		expect(liveRoleOf('member')).toBe('member');
		expect(liveRoleOf('banned')).toBe('member');
	});
});
