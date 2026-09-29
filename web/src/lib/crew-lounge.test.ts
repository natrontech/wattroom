// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveChannel, LiveCrew } from '$lib/crews-live';
import {
	lastDoor,
	lounge,
	loungeCrew,
	rememberCrew,
	rememberDoor,
	rememberRodeIn,
} from './crew-lounge';

const channel = (
	id: string,
	kind: LiveChannel['kind'] = 'voice',
): LiveChannel => ({
	id,
	kind,
	name: id,
});
const crew = (id: string, channels: LiveChannel[]): LiveCrew => ({
	id,
	name: id,
	role: 'member',
	channels,
});

// Text first, then voice by position — the order the live read hands over.
const tuesday = crew('tuesday', [
	channel('chat', 'text'),
	channel('lounge'),
	channel('coaching'),
]);

describe('the lounge (#3274)', () => {
	beforeEach(() => localStorage.clear());

	it('is where you last rode, else the first voice channel by position', () => {
		expect(lounge(tuesday, 'coaching')?.id).toBe('coaching');
		expect(lounge(tuesday, undefined)?.id).toBe('lounge');
		// A channel since deleted, or one of another crew, is not a lounge.
		expect(lounge(tuesday, 'gone')?.id).toBe('lounge');
		expect(lounge(crew('talk', [channel('chat', 'text')]))).toBeUndefined();
	});

	it('reads where you last rode from this device', () => {
		rememberRodeIn('tuesday', 'coaching');
		expect(lounge(tuesday)?.id).toBe('coaching');
	});

	it('is for the crew you picked, while you are still in it', () => {
		const sunday = crew('sunday', [channel('road')]);
		const talk = crew('talk', [channel('chat', 'text')]);
		expect(loungeCrew([talk, tuesday, sunday])?.id).toBe('tuesday');
		rememberCrew('sunday');
		expect(loungeCrew([talk, tuesday, sunday])?.id).toBe('sunday');
		expect(loungeCrew([talk, tuesday])?.id).toBe('tuesday');
		expect(loungeCrew([talk])).toBeUndefined();
	});

	it('remembers the door, and answers without storage', () => {
		expect(lastDoor()).toBeUndefined();
		rememberDoor('lounge');
		expect(lastDoor()).toBe('lounge');
		const refuse = () => {
			throw new Error('private window');
		};
		vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse });
		try {
			rememberDoor('alone');
			expect(lastDoor()).toBeUndefined();
			expect(lounge(tuesday)?.id).toBe('lounge');
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
