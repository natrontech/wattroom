// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// This environment has no localStorage of its own; the stub is what the
// module's stored choice lands in.
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => storage.get(k) ?? null,
	setItem: (k: string, v: string) => void storage.set(k, v),
	removeItem: (k: string) => void storage.delete(k),
	clear: () => storage.clear(),
});

// Module state (the enabled flag, the reply registry) is per import, so each
// case gets a fresh module against the window it set up.
async function fresh() {
	vi.resetModules();
	return await import('./notify.svelte');
}
type W = typeof globalThis & { wattroom?: unknown; Notification?: unknown };

beforeEach(() => {
	localStorage.clear();
	Object.defineProperty(document, 'hidden', {
		value: false,
		configurable: true,
	});
	document.hasFocus = () => false; // the rider is elsewhere unless a test says so
});
afterEach(() => {
	delete (globalThis as W).wattroom;
});

describe('in the desktop shell', () => {
	it('is on by default, off only when switched off, and hands the shell the reply field', async () => {
		const sent: unknown[] = [];
		(globalThis as W).wattroom = {
			notify: (n: unknown) => sent.push(n),
			onNotification: () => {},
		};
		let { notify } = await fresh();
		expect(notify.enabled).toBe(true);

		notify.push('Ruben · Velvet Hammer', 'on my way', 'chat-velvet', {
			href: '/r/velvet/chat',
			reply: { placeholder: 'Reply in Velvet Hammer', send: () => {} },
		});
		expect(sent).toEqual([
			{
				title: 'Ruben · Velvet Hammer',
				body: 'on my way',
				tag: 'chat-velvet',
				href: '/r/velvet/chat',
				replyPlaceholder: 'Reply in Velvet Hammer',
			},
		]);

		notify.disable();
		({ notify } = await fresh());
		expect(notify.enabled).toBe(false);
	});

	it('routes a reply to whoever pushed the notification, and a click to its href', async () => {
		let deliver: (p: {
			tag: string;
			href?: string;
			reply?: string;
		}) => void = () => {};
		(globalThis as W).wattroom = {
			notify: () => {},
			onNotification: (cb: typeof deliver) => (deliver = cb),
		};
		const { notify } = await fresh();
		const went: string[] = [];
		const replied: string[] = [];
		notify.listen((href) => went.push(href));
		notify.push('Mara', 'hi', 'dm-mara', {
			href: '/messages/dm/mara',
			reply: { placeholder: 'Reply to Mara', send: (t) => replied.push(t) },
		});

		deliver({ tag: 'dm-mara', href: '/messages/dm/mara', reply: 'coming' });
		expect(replied).toEqual(['coming']);
		expect(went).toEqual([]);
		deliver({ tag: 'dm-mara', href: '/messages/dm/mara' });
		expect(went).toEqual(['/messages/dm/mara']);
	});

	it('stays quiet while the window is the front one', async () => {
		const sent: unknown[] = [];
		(globalThis as W).wattroom = {
			notify: (n: unknown) => sent.push(n),
			onNotification: () => {},
		};
		document.hasFocus = () => true;
		const { notify } = await fresh();
		notify.push('Mara', 'hi', 'dm-mara');
		expect(sent).toEqual([]);
	});

	it('sends a test notification in front of the rider, and none once switched off (#1440)', async () => {
		const sent: { tag: string }[] = [];
		(globalThis as W).wattroom = {
			notify: (n: { tag: string }) => sent.push(n),
			onNotification: () => {},
		};
		document.hasFocus = () => true;
		const { notify } = await fresh();
		notify.push('Mara', 'hi', 'dm-mara');
		notify.test();
		expect(sent.map((n) => n.tag)).toEqual(['test']);
		notify.disable();
		notify.test();
		expect(sent).toHaveLength(1);
	});
});

describe('in a browser', () => {
	it('is off until switched on, and needs the permission', async () => {
		const { notify } = await fresh();
		expect(notify.enabled).toBe(false);
		localStorage.setItem('wattroom.notify.v1', '1');
		// Switched on before, but this browser never granted it: still off.
		const again = await fresh();
		expect(again.notify.enabled).toBe(false);
	});
});
