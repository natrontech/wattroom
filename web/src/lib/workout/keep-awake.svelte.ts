import { acquireWakeLock } from './wakelock';

/**
 * Holds the screen awake, and the desktop shell's machine with it, for as
 * long as `on()` is true: a ride on a channel and the phone remote, which no
 * solo ride's lock covered (#4219). Call it where an effect may run, a
 * component's script.
 */
export function keepAwakeWhile(on: () => boolean): void {
	$effect(() => {
		if (!on()) return;
		const lock = acquireWakeLock();
		return () => lock.release();
	});
}
