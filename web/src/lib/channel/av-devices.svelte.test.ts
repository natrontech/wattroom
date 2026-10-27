// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
function workingStorage() {
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear(),
	});
}
workingStorage();

let enumerated: MediaDeviceInfo[] | Error = [];
vi.stubGlobal('navigator', {
	mediaDevices: {
		enumerateDevices: async () => {
			if (enumerated instanceof Error) throw enumerated;
			return enumerated;
		},
	},
});

const { createDeviceChoices, deviceChoices } =
	await import('$lib/channel/av-devices.svelte');

/** enumerateDevices' shape, only the fields this module reads. */
function device(kind: MediaDeviceKind, deviceId: string) {
	return { kind, deviceId, label: deviceId, groupId: '' } as MediaDeviceInfo;
}

describe('device choices', () => {
	beforeEach(() => {
		store.clear();
		workingStorage();
		enumerated = [];
	});

	it('defaults to the browser default and remembers a pick', async () => {
		const first = createDeviceChoices();
		expect(first.micId).toBe('');
		first.setMic('headset');
		first.setCam('webcam');
		first.setOut('speakers');

		// A chosen mic survives a rejoin.
		const second = createDeviceChoices();
		expect(second.micId).toBe('headset');
		expect(second.camId).toBe('webcam');
		expect(second.outId).toBe('speakers');
	});

	it('is one store above the router, so a pick made with no call is the pick a join applies', () => {
		// #1858: /settings/voice writes it, the call's mic chain reads it.
		deviceChoices().setMic('usb');
		expect(deviceChoices().micId).toBe('usb');
		expect(deviceChoices()).toBe(deviceChoices());
	});

	it('sorts what it enumerates by kind', async () => {
		enumerated = [
			device('audioinput', 'mic-a'),
			device('videoinput', 'cam-a'),
			device('audiooutput', 'out-a'),
			device('audioinput', 'mic-b'),
		];
		const d = createDeviceChoices();
		await d.refresh();
		expect(d.mics.map((m) => m.deviceId)).toEqual(['mic-a', 'mic-b']);
		expect(d.cams.map((m) => m.deviceId)).toEqual(['cam-a']);
		expect(d.outs.map((m) => m.deviceId)).toEqual(['out-a']);
	});

	// #4161: the computer's mic while Bluetooth headphones play, until the
	// rider picks one, which always wins.
	it('names the computer’s mic beside Bluetooth headphones, and steps aside for a pick', async () => {
		const named = (
			kind: MediaDeviceKind,
			deviceId: string,
			label: string,
			groupId: string,
		) => ({ kind, deviceId, label, groupId }) as MediaDeviceInfo;
		enumerated = [
			named('audioinput', 'default', 'Default - AirPods (Bluetooth)', 'p'),
			named('audioinput', 'mac', 'MacBook Pro Microphone (Built-in)', 'm'),
			named('audiooutput', 'default', 'Default - AirPods (Bluetooth)', 'p'),
		];
		const d = createDeviceChoices();
		await d.refresh();
		expect(d.besideBluetooth?.deviceId).toBe('mac');

		d.setMic('default');
		expect(d.besideBluetooth).toBeNull();
	});

	it('empties the list rather than throwing when enumeration fails', async () => {
		enumerated = new Error('denied');
		const d = createDeviceChoices();
		await expect(d.refresh()).resolves.toBeUndefined();
		expect(d.mics).toEqual([]);
	});

	describe('forgetting an unplugged mic', () => {
		it('forgets a pick that is no longer in a named list (#640)', async () => {
			const d = createDeviceChoices();
			d.setMic('headset');
			enumerated = [device('audioinput', 'builtin')];
			await d.refresh();
			d.forgetMicIfUnplugged();
			expect(d.micId).toBe('');
			// And the forgetting is persisted, not just in memory.
			expect(createDeviceChoices().micId).toBe('');
		});

		it('keeps a pick that is still there', async () => {
			const d = createDeviceChoices();
			d.setMic('headset');
			enumerated = [
				device('audioinput', 'headset'),
				device('audioinput', 'builtin'),
			];
			await d.refresh();
			d.forgetMicIfUnplugged();
			expect(d.micId).toBe('headset');
		});

		it('keeps a pick when the list has no ids yet (#824)', async () => {
			// Before permission, enumerateDevices hands back blank ids. A blank
			// list must not un-choose a headset that is sitting right there —
			// this is the case that made the duplicated copies of this check
			// worth collapsing into one.
			const d = createDeviceChoices();
			d.setMic('headset');
			enumerated = [device('audioinput', ''), device('audioinput', '')];
			await d.refresh();
			d.forgetMicIfUnplugged();
			expect(d.micId).toBe('headset');
		});

		it('makes the pick again once the headset is back, across a reload (#4220)', async () => {
			const d = createDeviceChoices();
			d.setMic('airpods');
			enumerated = [device('audioinput', 'builtin')];
			await d.refresh();
			d.forgetMicIfUnplugged();
			expect(d.micId).toBe('');

			// A rejoin after the blink: a fresh store, the headset listed again.
			const back = createDeviceChoices();
			enumerated = [
				device('audioinput', 'airpods'),
				device('audioinput', 'builtin'),
			];
			await back.refresh();
			expect(back.micId).toBe('airpods');
		});

		it('lets a pick made meanwhile win over the one set aside', async () => {
			const d = createDeviceChoices();
			d.setMic('airpods');
			enumerated = [device('audioinput', 'builtin')];
			await d.refresh();
			d.forgetMicIfUnplugged();
			d.setMic('builtin');
			enumerated = [
				device('audioinput', 'airpods'),
				device('audioinput', 'builtin'),
			];
			await d.refresh();
			expect(d.micId).toBe('builtin');
		});

		it('does nothing when no mic was ever chosen', async () => {
			const d = createDeviceChoices();
			enumerated = [device('audioinput', 'builtin')];
			await d.refresh();
			d.forgetMicIfUnplugged();
			expect(d.micId).toBe('');
		});
	});
});
