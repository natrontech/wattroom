// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const played: string[] = [];
const pushed: { title: string; body: string }[] = [];

vi.mock('$lib/sound/cues', () => ({ play: (id: string) => played.push(id) }));
vi.mock('$lib/notify.svelte', () => ({
	notify: {
		push: (title: string, body: string) => pushed.push({ title, body }),
	},
	// The real rule (ADR-0042): hidden, or not the front window.
	away: () => document.hidden || !document.hasFocus(),
}));

import { announce, divertDmsWhileRiding } from './announce';
import { toasts } from '$lib/toast.svelte';

const arrival = (
	over: Partial<Parameters<typeof announce>[0]> = {},
): Parameters<typeof announce>[0] => ({
	kind: 'chat',
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

// A visible tab is also the front window here — the case that toasts. A
// hidden one is not looking twice over.
const hide = (hidden: boolean) => {
	Object.defineProperty(document, 'hidden', {
		value: hidden,
		configurable: true,
	});
	document.hasFocus = () => !hidden;
};

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

// A DM mid-ride goes where the rider can find it later, not across the
// numbers they are holding (#1743). Scoped by the arrival's KIND and never by
// the phase alone: this one function also announces the session starting in
// another room, which is the notification ADR-0042 calls the most valuable,
// and a blanket "quiet while running" would take that with it.
describe('a riding screen takes the DM', () => {
	const dm = (over = {}) =>
		arrival({
			kind: 'dm',
			tag: 'dm-ruben',
			title: 'Ruben',
			body: 'how is it going',
			href: '/messages/dm/ruben',
			...over,
		});

	it('hands a DM to the riding screen instead of toasting it', () => {
		const taken: string[] = [];
		const stop = divertDmsWhileRiding((a) => {
			taken.push(a.title);
			return true;
		});
		announce(dm());
		// The cue still sounds: something arrived, and a rider on a bike
		// learns that by ear.
		expect(played).toEqual(['chat']);
		expect(toasts.items).toEqual([]);
		expect(taken).toEqual(['Ruben']);
		stop();
	});

	it('leaves room chat, friends and a session starting alone', () => {
		const taken: string[] = [];
		const stop = divertDmsWhileRiding((a) => {
			taken.push(a.tag);
			return true;
		});
		announce(arrival({ kind: 'chat', tag: 'chat-velvet' }));
		announce(arrival({ kind: 'friend', tag: 'friend-req-kim', at: 2000 }));
		announce(arrival({ kind: 'session', tag: 'session-velvet', at: 3000 }));
		expect(taken).toEqual([]);
		expect(toasts.items).toHaveLength(3);
		stop();
	});

	it('toasts again once the screen refuses it, or goes', () => {
		// A ride that has ended: the screen is still mounted and hands it back.
		const stop = divertDmsWhileRiding(() => false);
		announce(dm());
		expect(toasts.items).toHaveLength(1);
		stop();
		// And with no riding screen at all.
		announce(dm({ tag: 'dm-kim', at: 2000, title: 'Kim' }));
		expect(toasts.items).toHaveLength(2);
	});

	it('still hands a hidden window to the OS — the rider is not looking', () => {
		hide(true);
		const taken: string[] = [];
		const stop = divertDmsWhileRiding((a) => {
			taken.push(a.tag);
			return true;
		});
		announce(dm());
		expect(pushed).toHaveLength(1);
		expect(taken).toEqual([]);
		stop();
	});
});
