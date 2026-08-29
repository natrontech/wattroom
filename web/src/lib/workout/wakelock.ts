/**
 * Keep the screen on while a ride runs (#58).
 *
 * A rider does not touch the screen for an hour, so without this the display
 * sleeps mid-workout and the dashboard they are riding to goes dark. Pairs with
 * the worker ticker (#51): the ticker keeps the ride *running* when the tab is
 * hidden, this keeps the screen *visible* when the tab is front and untouched.
 *
 * The trap (and the reason this is a module rather than one line at the call
 * site): the browser releases the lock automatically whenever the document
 * becomes hidden, and does NOT restore it when the tab comes back. A lock
 * acquired once on ride start silently stops protecting the screen after the
 * first tab switch — so this re-requests on every return to visibility.
 *
 * Failure is never ride-critical. The request rejects when the document is
 * hidden or the OS refuses (low battery); the ride runs identically either way,
 * so there is no error UI — the only cost of a refused lock is the OS screen
 * timeout the rider already has.
 */
export interface WakeLock {
	release(): void;
}

export function acquireWakeLock(): WakeLock {
	// Unit tests run in node; Web Bluetooth-less browsers may also lack this.
	if (
		typeof navigator === 'undefined' ||
		!navigator.wakeLock ||
		typeof document === 'undefined'
	) {
		return { release() {} };
	}

	let sentinel: WakeLockSentinel | null = null;
	let released = false;

	async function request() {
		try {
			sentinel = await navigator.wakeLock.request('screen');
			// The ride may have ended while the promise was in flight.
			if (released) await sentinel.release();
		} catch {
			// Hidden document or OS refusal — the ride does not care.
		}
	}

	function onVisible() {
		if (!released && document.visibilityState === 'visible') void request();
	}

	document.addEventListener('visibilitychange', onVisible);
	void request();

	return {
		release() {
			released = true;
			document.removeEventListener('visibilitychange', onVisible);
			void sentinel?.release().catch(() => {});
			sentinel = null;
		},
	};
}
