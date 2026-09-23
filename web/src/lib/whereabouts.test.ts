import { describe, expect, it } from 'vitest';
import { whereabouts, type VoicePlace } from './whereabouts';

const lounge: VoicePlace = {
	crewId: 'c1',
	crewName: 'Night Owls',
	channelId: 'v1',
	channelName: 'Lounge',
};

describe('whereabouts', () => {
	it('names the crew and the voice channel when the server did', () => {
		expect(whereabouts({ online: true, inVoice: true, channel: lounge })).toBe(
			'in Night Owls · Lounge',
		);
		expect(
			whereabouts({
				online: true,
				inVoice: true,
				riding: true,
				channel: lounge,
			}),
		).toBe('riding in Night Owls · Lounge');
	});

	it('says the state and not the place for a channel you may not enter', () => {
		expect(whereabouts({ online: true, inVoice: true })).toBe(
			'in a voice channel',
		);
		expect(whereabouts({ online: true, inVoice: true, riding: true })).toBe(
			'riding elsewhere',
		);
	});

	it('never infers riding from nowhere, and says nothing about the absent', () => {
		expect(whereabouts({ online: true, riding: true })).toBe('online');
		expect(whereabouts({ online: false, inVoice: false, riding: false })).toBe(
			'',
		);
		expect(whereabouts({})).toBe('');
	});
});
