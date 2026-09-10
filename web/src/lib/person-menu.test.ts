import { describe, expect, it, vi } from 'vitest';
import type { MenuItem } from '$lib/context-menu.svelte';
import { personMenu } from '$lib/person-menu';
import { mixer } from '$lib/sound/mixer.svelte';

// The surface says who is in voice (#874); the fader writes through the room's
// av when there is one.
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
	entries.filter(
		(entry): entry is MenuItem =>
			entry !== 'separator' && entry.kind !== 'slider',
	);

/** What the menu reads top to bottom; a separator reads as an em dash. */
const labels = (entries: ReturnType<typeof personMenu>): string[] =>
	entries.map((entry) => (entry === 'separator' ? '—' : entry.label));

const faders = (entries: ReturnType<typeof personMenu>) =>
	entries.filter((entry) => entry !== 'separator' && entry.kind === 'slider');

describe('personMenu (#486)', () => {
	it('leads with what a click on the object already does', () => {
		expect(labels(personMenu('u1', () => {}))).toEqual([
			'Rider page',
			'Message',
			'Add friend',
		]);
		expect(labels(personMenu('u1', () => {}, { conversation: true }))).toEqual([
			'Open the conversation',
			'Rider page',
			'Add friend',
		]);
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
			'Rider page',
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

	// One person, one menu: the tile used to append the ban itself, so the
	// roster row beside it offered no way to stop the same griefer (#951).
	it('ends on the ban, after a separator, and never on yourself', () => {
		const banned = vi.fn();
		const entries = personMenu('u1', () => {}, { ban: banned });
		expect(labels(entries)).toEqual([
			'Rider page',
			'Message',
			'Add friend',
			'—',
			'Ban from the room',
		]);
		expect(entries.at(-1)).toMatchObject({ danger: true });
		items(entries).at(-1)!.onSelect();
		expect(banned).toHaveBeenCalledOnce();
		expect(
			labels(personMenu('me', () => {}, { you: true, ban: banned })),
		).not.toContain('Ban from the room');
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

	it('offers no fader for someone not in voice, and none on yourself', () => {
		expect(faders(personMenu('u1', () => {}))).toEqual([]);
		expect(
			faders(personMenu('me', () => {}, { you: true, volume: { name: 'me' } })),
		).toEqual([]);
	});

	it('sets the level itself when the room has no voice connection', () => {
		room.current = null;
		const [fader] = faders(
			personMenu('u3', () => {}, { volume: { name: 'Ruben' } }),
		);
		if (fader?.kind !== 'slider')
			throw new Error('no fader for a rider in voice');
		fader.onInput(50);
		expect(mixer.riderGain('u3')).toBe(0.5);
		mixer.setRiderGain('u3', 1);
	});

	it('reads the rider back at their stored level and writes through av', () => {
		room.current = { av: { voice: { u1: 'live' }, setRiderGain } };
		mixer.setRiderGain('u1', 1.4, 'Ada');
		const entries = personMenu('u1', () => {}, { volume: { name: 'Ada' } });
		const [fader] = faders(entries);
		if (fader?.kind !== 'slider')
			throw new Error('no fader for a rider in voice');
		expect([fader.value, fader.format(fader.value), fader.max]).toEqual([
			140,
			'140%',
			200,
		]);
		// Before the friendship, after the room's own verbs.
		expect(labels(entries)).toEqual([
			'Rider page',
			'Message',
			'Volume',
			'Add friend',
		]);
		fader.onInput(80);
		expect(setRiderGain).toHaveBeenCalledWith('u1', 0.8, 'Ada');
		mixer.setRiderGain('u1', 1);
	});
});
