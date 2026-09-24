// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { channelAddress } from '$lib/channel/address';

const played: string[] = [];
vi.mock('$lib/sound/cues', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sound/cues')>()),
	play: (id: string) => played.push(id),
}));
vi.mock('$lib/notify.svelte', () => ({
	notify: { push: () => {} },
	away: () => false,
}));
const signedIn = vi.hoisted(() => ({ me: null as null | { id: string } }));
vi.mock('$lib/account.svelte', () => ({ account: signedIn }));

import { connectionCues } from '$lib/channel/connection-cues.svelte';
import { toasts } from '$lib/toast.svelte';

// A hand-driven tick: the roster is what these cues are about. $state, so an
// effect that fails to track it is caught rather than papered over.
let fakeTick = $state<unknown>(null);
let fakePoke = $state<unknown>(null);
const live = {
	get tick() {
		return fakeTick;
	},
	status: 'live',
	get lastPoke() {
		return fakePoke;
	},
	pushEvent() {},
};
// Voice never joined: no call, no screens, nobody speaking.
const av = {
	status: 'idle',
	stageSources: [],
	speaking: {},
	setDeckPlaying() {},
};

let stop = () => {};
function listen() {
	stop = $effect.root(() =>
		connectionCues({
			address: channelAddress('c', 'lounge', 'Lounge'),
			live: live as never,
			av: av as never,
		}),
	);
}

describe('connectionCues', () => {
	afterEach(() => {
		stop();
		// The tick is module state: a roster left behind here is the next
		// test's opening observation.
		fakeTick = null;
		fakePoke = null;
		signedIn.me = null;
	});

	// Every tick carries one; the roster is what these two are about.
	const idle = { phase: 'idle', elapsed: 0 };

	// #906: an away rider stays in the roster, so the membership cues never
	// fire and a channel can empty to one in silence.
	it('sounds the pair when a rider steps out and comes back', async () => {
		listen();
		fakeTick = { state: idle, roster: [{ id: 'bob', name: 'Bob' }] };
		await tick();
		played.length = 0;

		fakeTick = {
			state: idle,
			roster: [{ id: 'bob', name: 'Bob', away: true }],
		};
		await tick();
		expect(played).toEqual(['leave']);

		fakeTick = {
			state: idle,
			roster: [{ id: 'bob', name: 'Bob', away: false }],
		};
		await tick();
		expect(played).toEqual(['leave', 'join']);
	});

	// #2721: a rider looking at the screen heard the cue and nothing else.
	it('names who poked, with a way to poke back', async () => {
		listen();
		fakePoke = { to: 'me', fromId: 'jan', from: 'Jan', at: 5000 };
		await tick();
		expect(played).toContain('poke');
		expect(toasts.items.at(-1)).toMatchObject({
			text: 'Jan poked you in Lounge',
			action: { label: 'Poke back' },
		});
	});

	// The hub hands the sender's socket its own poke back: it landed.
	it('tells the sender their poke landed, without the cue', async () => {
		signedIn.me = { id: 'me' };
		listen();
		fakeTick = { state: idle, roster: [{ id: 'sven', name: 'Sven' }] };
		await tick();
		played.length = 0;
		fakePoke = { to: 'sven', fromId: 'me', from: 'Me', at: 6000 };
		await tick();
		expect(played).toEqual([]);
		expect(toasts.items.at(-1)?.text).toBe('Poked Sven.');
	});

	// Arriving is the join cue's own event — a rider walking in is not a
	// rider coming back, and must not sound twice.
	it('does not hear an arrival as a return', async () => {
		listen();
		fakeTick = { state: idle, roster: [{ id: 'bob', name: 'Bob' }] };
		await tick();
		played.length = 0;

		fakeTick = {
			state: idle,
			roster: [
				{ id: 'bob', name: 'Bob' },
				{ id: 'ann', name: 'Ann' },
			],
		};
		await tick();
		expect(played).toEqual(['join']);
	});
});
