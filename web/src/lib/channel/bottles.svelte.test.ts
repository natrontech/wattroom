// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { channelAddress } from '$lib/channel/address';
import type { Effort } from '$lib/roadside';

const announced = vi.hoisted(() => [] as { title: string; kind: string }[]);
vi.mock('$lib/messages/announce', () => ({
	announce: (arrival: { title: string; kind: string }) =>
		announced.push(arrival),
}));
const signedIn = vi.hoisted(() => ({ me: { id: 'sven' } as { id: string } }));
vi.mock('$lib/account.svelte', () => ({ account: signedIn }));

import { bottleHandUps } from '$lib/channel/bottles.svelte';
import { toasts } from '$lib/toast.svelte';

const hard: Effort = {
	targetWatts: 300,
	ftp: 250,
	calledZone: 0,
	sprinting: false,
};
const easy: Effort = { ...hard, targetWatts: 125 };

let bottle = $state<unknown>(null);
let effort = $state<Effort>(hard);
const live = {
	get lastBottle() {
		return bottle;
	},
	tick: { roster: [{ id: 'sven', name: 'Sven' }] },
};

let stop = () => {};
function listen() {
	stop = $effect.root(() =>
		bottleHandUps({
			address: channelAddress('c', 'lounge', 'Lounge'),
			live: live as never,
			effort: () => effort,
		}),
	);
}

describe('a bottle waits for the valley (#3022)', () => {
	afterEach(() => {
		stop();
		bottle = null;
		effort = hard;
		announced.length = 0;
	});

	it('is held through a hard block and handed over when the ride eases', async () => {
		listen();
		bottle = {
			to: 'sven',
			fromId: 'ana',
			from: 'Ana',
			at: 1000,
			kind: 'bottle',
		};
		await tick();
		expect(announced).toEqual([]);

		effort = { ...hard, targetWatts: 280 }; // still working
		await tick();
		expect(announced).toEqual([]);

		effort = easy;
		await tick();
		expect(announced.map((a) => a.title)).toEqual(['Ana handed you a bottle']);

		// Handed over once: the valley going on does not hand it over again.
		effort = { ...easy, targetWatts: 120 };
		await tick();
		expect(announced).toHaveLength(1);
	});

	it('is handed over at once in a valley, and every bottle held comes too', async () => {
		listen();
		bottle = {
			to: 'sven',
			fromId: 'ana',
			from: 'Ana',
			at: 1000,
			kind: 'bottle',
		};
		await tick();
		bottle = {
			to: 'sven',
			fromId: 'ben',
			from: 'Ben',
			at: 2000,
			kind: 'bottle',
		};
		await tick();
		expect(announced).toEqual([]);
		effort = easy;
		await tick();
		expect(announced.map((a) => a.title)).toEqual([
			'Ana handed you a bottle',
			'Ben handed you a bottle',
		]);

		bottle = { to: 'sven', fromId: 'cy', from: 'Cy', at: 3000, kind: 'bottle' };
		await tick();
		expect(announced.at(-1)?.title).toBe('Cy handed you a bottle');
	});

	it('tells the one who handed it up that it landed, and holds nothing', async () => {
		signedIn.me = { id: 'ana' };
		listen();
		bottle = {
			to: 'sven',
			fromId: 'ana',
			from: 'Ana',
			at: 1000,
			kind: 'bottle',
		};
		await tick();
		expect(toasts.items.at(-1)?.text).toBe('Handed Sven a bottle.');
		effort = easy;
		await tick();
		expect(announced).toEqual([]);
		signedIn.me = { id: 'sven' };
	});
});
