import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireWakeLock } from './wakelock';

/**
 * Vitest runs in node, so both globals are stubbed — which is fine, because the
 * module's whole job is the choreography around the API, not the API itself.
 */
function stub() {
	const sentinels: Array<{ released: boolean }> = [];
	let listener: (() => void) | undefined;
	const doc = {
		visibilityState: 'visible' as 'visible' | 'hidden',
		addEventListener: (_: string, cb: () => void) => (listener = cb),
		removeEventListener: () => (listener = undefined),
	};
	vi.stubGlobal('document', doc);
	vi.stubGlobal('navigator', {
		wakeLock: {
			request: async () => {
				const sentinel = {
					released: false,
					async release() {
						sentinel.released = true;
					},
				};
				sentinels.push(sentinel);
				return sentinel;
			},
		},
	});
	return {
		sentinels,
		doc,
		becomeVisible: () => listener?.(),
		get listening() {
			return listener !== undefined;
		},
	};
}

afterEach(() => vi.unstubAllGlobals());

describe('acquireWakeLock', () => {
	it('requests a screen lock on acquire and releases it on release', async () => {
		const env = stub();
		const lock = acquireWakeLock();
		await vi.waitFor(() => expect(env.sentinels).toHaveLength(1));

		lock.release();
		await vi.waitFor(() => expect(env.sentinels[0].released).toBe(true));
	});

	it('re-requests when the tab becomes visible again', async () => {
		// THE trap (#58): the browser releases the lock on hide and does not
		// restore it. Without this re-request, the lock only ever survives until
		// the rider's first tab switch — and then never protects the screen again.
		const env = stub();
		acquireWakeLock();
		await vi.waitFor(() => expect(env.sentinels).toHaveLength(1));

		env.becomeVisible();
		await vi.waitFor(() => expect(env.sentinels).toHaveLength(2));
	});

	it('stops listening once released, so an ended ride cannot re-lock', async () => {
		const env = stub();
		const lock = acquireWakeLock();
		await vi.waitFor(() => expect(env.sentinels).toHaveLength(1));

		lock.release();
		expect(env.listening).toBe(false);
		env.becomeVisible();
		expect(env.sentinels).toHaveLength(1);
	});

	it('releases a sentinel that resolved after the ride already ended', async () => {
		// request() is async; stop() can beat the promise. The late sentinel must
		// not keep the screen awake after the rider walked away.
		const env = stub();
		const lock = acquireWakeLock();
		lock.release(); // before the request resolves

		await vi.waitFor(() => expect(env.sentinels).toHaveLength(1));
		await vi.waitFor(() => expect(env.sentinels[0].released).toBe(true));
	});

	it('is a no-op where the API does not exist', () => {
		vi.stubGlobal('navigator', {});
		expect(() => acquireWakeLock().release()).not.toThrow();
	});
});

/**
 * The desktop half (#296). The browser lock keeps the screen on; the shell's
 * blocker keeps the machine from sleeping under it, and a blocker left running
 * is a laptop that never sleeps again. Feature-detected, so a browser sees
 * none of this.
 */
describe('the desktop shell', () => {
	it('is told to hold and to let go, around the ride', () => {
		const env = stub();
		const calls: boolean[] = [];
		vi.stubGlobal('wattroom', { keepAwake: (on: boolean) => calls.push(on) });

		const lock = acquireWakeLock();
		expect(calls).toEqual([true]);
		lock.release();
		expect(calls).toEqual([true, false]);
		expect(env.listening).toBe(false);
	});

	it('holds even where the browser has no wake lock of its own', () => {
		// A shell build, or any browser without the API: the screen lock is
		// unavailable and the machine should still stay awake.
		vi.stubGlobal('navigator', {});
		vi.stubGlobal('document', undefined);
		const calls: boolean[] = [];
		vi.stubGlobal('wattroom', { keepAwake: (on: boolean) => calls.push(on) });

		const lock = acquireWakeLock();
		expect(calls).toEqual([true]);
		lock.release();
		expect(calls).toEqual([true, false]);
	});

	it('is absent in a browser, and nothing throws', () => {
		stub();
		expect(() => acquireWakeLock().release()).not.toThrow();
	});
});
