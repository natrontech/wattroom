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
 *
 * In the desktop shell this also holds the machine awake (#296). The browser
 * lock keeps the SCREEN on and the browser drops it whenever the document
 * hides; the shell's power blocker keeps the system from sleeping under it,
 * which is the half a tab cannot reach. Feature-detected per ADR-0037, so a
 * browser is unchanged.
 */
export interface WakeLock {
	release(): void;
}

/** The desktop shell, when there is one. ADR-0037: absent means a browser. */
function shellKeepAwake(on: boolean): void {
	(
		globalThis as { wattroom?: { keepAwake?: (on: boolean) => void } }
	).wattroom?.keepAwake?.(on);
}

export function acquireWakeLock(): WakeLock {
	// The shell's blocker is independent of the browser lock below: a build
	// without navigator.wakeLock should still stop the machine sleeping.
	shellKeepAwake(true);

	// Unit tests run in node; Web Bluetooth-less browsers may also lack this.
	if (
		typeof navigator === 'undefined' ||
		!navigator.wakeLock ||
		typeof document === 'undefined'
	) {
		return {
			release() {
				shellKeepAwake(false);
			},
		};
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
			shellKeepAwake(false);
			document.removeEventListener('visibilitychange', onVisible);
			void sentinel?.release().catch(() => {});
			sentinel = null;
		},
	};
}
