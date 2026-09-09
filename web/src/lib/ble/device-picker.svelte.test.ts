// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { BleDevice } from './device-picker.svelte';

const { devicePicker } = await import('./device-picker.svelte');

type Listener = (devices: BleDevice[] | null) => void;

function fakeShell() {
	const shell = {
		listeners: [] as Listener[],
		picked: [] as (string | null)[],
		onBleScan(cb: Listener) {
			this.listeners.push(cb);
		},
		pickDevice(deviceId: string | null) {
			this.picked.push(deviceId);
		},
	};
	Object.defineProperty(globalThis, 'wattroom', {
		configurable: true,
		value: shell,
	});
	return shell;
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'wattroom');
});

describe('the desktop shell’s device picker (#1716)', () => {
	it('does nothing at all in a browser, where Chrome draws its own', () => {
		expect(() => devicePicker.start()).not.toThrow();
		expect(devicePicker.devices).toBeNull();
		// No shell to answer: the call is silent rather than a crash on a page
		// the browser build renders on every route.
		expect(() => devicePicker.pick('a')).not.toThrow();
	});

	it('follows the scan as it grows, and closes when the shell says so', () => {
		const shell = fakeShell();
		devicePicker.start();
		// Once, however many times the layout mounts.
		devicePicker.start();
		expect(shell.listeners).toHaveLength(1);
		const [notify] = shell.listeners;

		// The first emit is Chromium's, ~130 ms in with nothing heard yet:
		// the picker opens on it and says it is listening.
		notify([]);
		expect(devicePicker.devices).toEqual([]);

		notify([{ id: 'a', name: 'KICKR CORE 8F2A' }]);
		notify([
			{ id: 'a', name: 'KICKR CORE 8F2A' },
			{ id: 'b', name: 'Polar H10' },
		]);
		// The old native message box was a snapshot taken on the first device;
		// a second sensor advertising a moment later was invisible.
		expect(devicePicker.devices).toHaveLength(2);

		devicePicker.pick('b');
		expect(shell.picked).toEqual(['b']);
		// The shell closes it, not the answer — clearing here would race a
		// request that has already moved on.
		expect(devicePicker.devices).toHaveLength(2);

		notify(null);
		expect(devicePicker.devices).toBeNull();
	});
});
