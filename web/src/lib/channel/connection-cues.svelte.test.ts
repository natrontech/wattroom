// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { channelAddress } from '$lib/channel/address';

const played: string[] = [];
vi.mock('$lib/sound/cues', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sound/cues')>()),
	play: (id: string) => played.push(id),
}));
vi.mock('$lib/notify.svelte', () => ({ notify: { push: () => {} } }));

import { connectionCues } from '$lib/channel/connection-cues.svelte';

// A hand-driven tick: the roster is what these cues are about. $state, so an
// effect that fails to track it is caught rather than papered over.
let fakeTick = $state<unknown>(null);
const live = {
	get tick() {
		return fakeTick;
	},
	status: 'live',
	lastPoke: null,
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
