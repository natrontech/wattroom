// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const played: string[] = [];
const pushed: { title: string; body: string }[] = [];

vi.mock('$lib/sound/cues', () => ({ play: (id: string) => played.push(id) }));
vi.mock('$lib/notify.svelte', () => ({
	notify: {
		push: (title: string, body: string) => pushed.push({ title, body }),
	},
}));

import { announce } from './announce';
import { toasts } from '$lib/toast.svelte';

const arrival = (over: Partial<Parameters<typeof announce>[0]> = {}) => ({
	tag: 'chat-velvet-hammer',
	at: 1000,
	title: 'Ruben · Velvet Hammer',
	body: 'queue this one',
	href: '/r/velvet-hammer/chat',
	reading: false,
	...over,
});

// The cross-tab dedup is a localStorage claim, and this environment has no
// storage — without one every arrival would announce, which is the very case
// under test.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	clear: () => store.clear(),
});

const hide = (hidden: boolean) =>
	Object.defineProperty(document, 'hidden', {
		value: hidden,
		configurable: true,
	});

beforeEach(() => {
	played.length = 0;
	pushed.length = 0;
	localStorage.clear();
	for (const toast of [...toasts.items]) toasts.dismiss(toast.id);
	hide(false);
});

describe('announce', () => {
	it('toasts a link to the thread while the tab is visible', () => {
		announce(arrival());
		expect(played).toEqual(['chat']);
		expect(pushed).toEqual([]);
		expect(toasts.items).toEqual([
			expect.objectContaining({
				text: 'Ruben · Velvet Hammer: queue this one',
				href: '/r/velvet-hammer/chat',
			}),
		]);
	});

	it('hands a hidden tab to the OS instead — never both', () => {
		hide(true);
		announce(arrival());
		expect(pushed).toEqual([
			{ title: 'Ruben · Velvet Hammer', body: 'queue this one' },
		]);
		expect(toasts.items).toEqual([]);
	});

	// The whole point of the shared tag: the in-room socket and the presence
	// feed both see the same line, and it announces once.
	it('announces one line once, however many paths see it', () => {
		announce(arrival());
		announce(arrival({ href: '/messages/r/velvet-hammer' }));
		expect(played).toEqual(['chat']);
		expect(toasts.items).toHaveLength(1);
	});

	it('says nothing about the thread you are reading', () => {
		announce(arrival({ reading: true }));
		expect(played).toEqual([]);
		expect(toasts.items).toEqual([]);
	});

	// …and staying silent must not burn the line: closing the thread and
	// letting the next poll see it again would then announce nothing ever.
	it('leaves a line you were reading unclaimed', () => {
		announce(arrival({ reading: true }));
		announce(arrival());
		expect(toasts.items).toHaveLength(1);
	});

	it('drops the colon when the line is an image', () => {
		announce(arrival({ body: '', title: 'Kim' }));
		expect(toasts.items[0].text).toBe('Kim');
	});
});
