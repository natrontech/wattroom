// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const played: string[] = [];
vi.mock('$lib/sound/cues', () => ({ play: (id: string) => played.push(id) }));
// A focused, visible window: the toast is the whole announcement.
vi.mock('$lib/notify.svelte', () => ({
	notify: { push: () => {} },
	away: () => false,
}));

import { announce } from '$lib/messages/announce';
import { pokeArrival } from '$lib/poke';
import { toasts } from '$lib/toast.svelte';

beforeEach(() => {
	played.length = 0;
	for (const toast of toasts.items) toasts.dismiss(toast.id);
	localStorage.clear();
});

describe('a poke that reaches you (#2721)', () => {
	// The report: a rider looking at the screen heard a sound and saw nothing,
	// so nobody knew who had poked them.
	it('names who poked on a focused screen, with a way to poke back', () => {
		const back = vi.fn();
		announce(
			pokeArrival(
				{ fromId: 'jan', from: 'Jan', at: 1000, text: 'wheel!', dm: true },
				back,
			),
		);
		expect(played).toEqual(['poke']);
		expect(toasts.items).toHaveLength(1);
		expect(toasts.items[0]).toMatchObject({
			text: 'Jan poked you: wheel!',
			href: '/messages/dm/jan',
		});
		toasts.items[0].action!.run();
		expect(back).toHaveBeenCalledOnce();
	});

	// A friend's poke is tapped live by the hub AND found by the thread's
	// poll, with the line's own time on both.
	it("announces a friend's poke once, whichever path found it first", () => {
		const poke = { fromId: 'jan', from: 'Jan', at: 2000, dm: true };
		announce(
			pokeArrival(poke, () => {}, { name: 'Lounge', href: '/c/lounge' }),
		);
		announce(pokeArrival(poke, () => {}));
		expect(played).toEqual(['poke']);
		expect(toasts.items).toHaveLength(1);
	});

	it('points a channel poke at the channel it was heard in', () => {
		announce(
			pokeArrival({ fromId: 'kim', from: 'Kim', at: 3000 }, () => {}, {
				name: 'Lounge',
				href: '/c/lounge',
			}),
		);
		expect(toasts.items[0]).toMatchObject({
			text: 'Kim poked you in Lounge',
			href: '/c/lounge',
		});
	});
});
