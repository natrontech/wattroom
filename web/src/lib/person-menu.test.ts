import { describe, expect, it, vi } from 'vitest';
import type { MenuItem } from '$lib/context-menu.svelte';
import { personMenu } from '$lib/person-menu';
import { mixer } from '$lib/sound/mixer.svelte';

// The volume fader asks the live room who is in voice (#874); no room, no
// fader, which is every case below except the last two.
const room = vi.hoisted(() => ({
	current: null as null | {
		av: {
			voice: Record<string, 'live' | 'muted'>;
			setRiderGain: (id: string, gain: number, name?: string) => void;
		};
	},
}));
vi.mock('$lib/room/connection.svelte', () => ({ roomConnection: room }));

/** The entries you select; a fader is dragged and has no `onSelect`. */
const items = (entries: ReturnType<typeof personMenu>): MenuItem[] =>
	entries.filter((entry): entry is MenuItem => entry.kind !== 'slider');

describe('personMenu (#486)', () => {
	it('leads with what a click on the object already does', () => {
		expect(personMenu('u1', () => {}).map((item) => item.label)).toEqual([
			'View profile',
			'Message',
			'Add friend',
		]);
		expect(
			personMenu('u1', () => {}, { conversation: true }).map(
				(item) => item.label,
			),
		).toEqual(['Open the conversation', 'View profile', 'Add friend']);
	});

	it('goes where the row already links', () => {
		const go = vi.fn();
		for (const item of items(personMenu('u1', go)).slice(0, 2)) item.onSelect();
		expect(go.mock.calls).toEqual([['/u/u1'], ['/messages/dm/u1']]);
	});

	it('offers no conversation and no friendship with yourself', () => {
		const [, message, friend] = items(
			personMenu('me', () => {}, { you: true }),
		);
		expect([message.disabled, friend.disabled]).toEqual([true, true]);
		const [, theirs, theirFriend] = items(personMenu('them', () => {}));
		expect(theirs.disabled).toBeFalsy();
		expect(theirFriend.disabled).toBeFalsy();
	});

	it('offers a capability-gated room poke', () => {
		const poke = vi.fn();
		const entries = items(
			personMenu('u1', () => {}, {
				poke: { onSelect: poke, disabled: true, hint: 'not in the room' },
			}),
		);
		expect(entries.map((item) => item.label)).toEqual([
			'View profile',
			'Message',
			'Poke',
			'Add friend',
		]);
		expect(entries[2]).toMatchObject({
			disabled: true,
			hint: 'not in the room',
		});
		entries[2].onSelect();
		expect(poke).toHaveBeenCalledOnce();
	});

	// The menu never asks who is already a friend — the server's own refusal
	// is the answer, and it is a sentence worth showing (#532).
	it('asks the server to be friends, by id', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const [, , friend] = items(personMenu('u2', () => {}));
		friend.onSelect();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		const [path, init] = fetchMock.mock.calls[0];
		expect(path).toBe('/api/friends');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ userId: 'u2' });
		vi.unstubAllGlobals();
	});
});

// A rider's volume travels with the rider instead of living on the two rows
// that used to render a speaker (#874).
describe('personMenu volume', () => {
	const setRiderGain = vi.fn();
	const inVoice = (voice: Record<string, 'live' | 'muted'>) =>
		(room.current = { av: { voice, setRiderGain } });

	it('offers no fader outside a room, or for someone not in voice', () => {
		room.current = null;
		expect(personMenu('u1', () => {}).some((e) => e.kind === 'slider')).toBe(
			false,
		);
		inVoice({ u2: 'live' });
		expect(personMenu('u1', () => {}).some((e) => e.kind === 'slider')).toBe(
			false,
		);
	});

	it('offers no fader on yourself — you are not in your own mix', () => {
		inVoice({ me: 'live' });
		expect(
			personMenu('me', () => {}, { you: true }).some(
				(e) => e.kind === 'slider',
			),
		).toBe(false);
	});

	it('reads the rider back at their stored level and writes through av', () => {
		inVoice({ u1: 'live' });
		mixer.setRiderGain('u1', 1.4, 'Ada');
		const entries = personMenu('u1', () => {}, { name: 'Ada' });
		const fader = entries.find((e) => e.kind === 'slider');
		if (fader?.kind !== 'slider')
			throw new Error('no fader for a rider in voice');
		expect([fader.value, fader.format(fader.value), fader.max]).toEqual([
			140,
			'140%',
			200,
		]);
		// Before the friendship, after the room's own verbs.
		expect(entries.map((e) => e.label)).toEqual([
			'View profile',
			'Message',
			'Volume',
			'Add friend',
		]);
		fader.onInput(80);
		expect(setRiderGain).toHaveBeenCalledWith('u1', 0.8, 'Ada');
		mixer.setRiderGain('u1', 1);
	});
});
