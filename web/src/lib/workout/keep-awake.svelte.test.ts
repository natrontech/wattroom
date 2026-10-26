// @vitest-environment happy-dom
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepAwakeWhile } from './keep-awake.svelte';
import { acquireWakeLock } from './wakelock';

/**
 * A ride on a channel and the phone remote hold the lock too (#4219): the
 * screen and the Mac slept through a crew session because only a solo ride
 * ever asked. The shell's blocker counts its holders, so one letting go never
 * drops another's.
 */
afterEach(() => vi.unstubAllGlobals());

function shell() {
	const calls: boolean[] = [];
	vi.stubGlobal('navigator', {});
	vi.stubGlobal('wattroom', { keepAwake: (on: boolean) => calls.push(on) });
	return calls;
}

describe('keepAwakeWhile', () => {
	it('holds while riding and lets go when the ride ends', async () => {
		const calls = shell();
		let riding = $state(false);
		const stop = $effect.root(() => keepAwakeWhile(() => riding));
		await tick();
		expect(calls).toEqual([]);

		riding = true;
		await tick();
		expect(calls).toEqual([true]);

		riding = false;
		await tick();
		expect(calls).toEqual([true, false]);
		stop();
	});

	it('lets go when its surface goes, still riding', async () => {
		const calls = shell();
		const stop = $effect.root(() => keepAwakeWhile(() => true));
		await tick();
		stop();
		expect(calls).toEqual([true, false]);
	});
});

describe('two holders at once', () => {
	it('keeps the machine awake until the last one lets go', () => {
		const calls = shell();
		const ride = acquireWakeLock();
		const remote = acquireWakeLock();
		expect(calls).toEqual([true]);

		ride.release();
		expect(calls).toEqual([true]);
		// A second release of the same lock is not a second holder leaving.
		ride.release();
		expect(calls).toEqual([true]);

		remote.release();
		expect(calls).toEqual([true, false]);
	});
});
