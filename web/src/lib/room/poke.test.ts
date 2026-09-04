// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const played: string[] = [];
const pushed: { title: string; body: string; tag: string }[] = [];

vi.mock('$lib/sound/cues', () => ({ play: (id: string) => played.push(id) }));
vi.mock('$lib/notify.svelte', () => ({
	notify: {
		push: (title: string, body: string, tag: string) =>
			pushed.push({ title, body, tag }),
	},
}));

import { announcePoke } from './poke';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => void store.set(key, value),
	clear: () => store.clear(),
});

beforeEach(() => {
	played.length = 0;
	pushed.length = 0;
	store.clear();
});

describe('announcePoke', () => {
	it('plays the poke cue and hands the alert to notifications', () => {
		announcePoke(
			{ to: 'sven', fromId: 'jan', from: 'Jan', at: 1000 },
			'velvet',
			'Velvet Hammer',
		);
		expect(played).toEqual(['poke']);
		expect(pushed).toEqual([
			{
				title: 'Jan',
				body: 'Poked you in Velvet Hammer',
				tag: 'poke-velvet-jan',
			},
		]);
	});

	it('announces the same server event only once across tabs', () => {
		const poke = { to: 'sven', fromId: 'jan', from: 'Jan', at: 1000 };
		announcePoke(poke, 'velvet', 'Velvet Hammer');
		announcePoke(poke, 'velvet', 'Velvet Hammer');
		expect(played).toEqual(['poke']);
		expect(pushed).toHaveLength(1);
	});

	it('ignores an incomplete event', () => {
		announcePoke({ from: 'forged' }, 'velvet', 'Velvet Hammer');
		expect(played).toEqual([]);
		expect(pushed).toEqual([]);
	});
});
