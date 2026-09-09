// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBleSensor } from './sensor';
import type { SensorReading, SensorStatus } from './sensor';

/**
 * The smallest GATT stack that can drop a link and hear it reconnect.
 *
 * A strap slipping is the ordinary case and it fails silently — nothing
 * throws, no promise rejects, the readings simply stop — so it is exactly the
 * failure a fake has to be able to stage (#1716).
 */
class FakeCharacteristic {
	listeners: { cb: (event: Event) => void; signal?: AbortSignal }[] = [];
	notifications = 0;
	async startNotifications() {
		this.notifications++;
	}
	addEventListener(
		_type: string,
		cb: (event: Event) => void,
		options?: { signal?: AbortSignal },
	) {
		this.listeners.push({ cb, signal: options?.signal });
	}
	/** One packet, delivered the way Chromium delivers it. */
	notify(bytes: number[]) {
		const value = new DataView(Uint8Array.of(...bytes).buffer);
		for (const { cb, signal } of this.listeners) {
			if (signal?.aborted) continue;
			cb({ target: { value } } as unknown as Event);
		}
	}
	/** Listeners still wired to the live attach. */
	get live() {
		return this.listeners.filter(({ signal }) => !signal?.aborted).length;
	}
}

class FakeDevice {
	name = 'Polar H10';
	characteristic = new FakeCharacteristic();
	connects = 0;
	disconnects = 0;
	/** Fails this many gatt.connect() calls before letting one through. */
	failConnects = 0;
	#dropped: (() => void)[] = [];
	gatt = {
		connect: async () => {
			this.connects++;
			if (this.failConnects > 0) {
				this.failConnects--;
				throw new Error('GATT connect failed');
			}
			return {
				getPrimaryService: async () => ({
					getCharacteristic: async () => this.characteristic,
				}),
			};
		},
		disconnect: () => {
			this.disconnects++;
		},
	};
	addEventListener(type: string, cb: () => void) {
		if (type === 'gattserverdisconnected') this.#dropped.push(cb);
	}
	/** The strap loses contact. Nothing throws; the packets just stop. */
	drop() {
		for (const cb of this.#dropped) cb();
	}
}

let device: FakeDevice;

function makeSensor() {
	const readings: SensorReading[] = [];
	const statuses: SensorStatus[] = [];
	const sensor = createBleSensor({
		kind: 'heart-rate',
		service: 0x180d,
		characteristic: 0x2a37,
		defaultName: 'Heart rate strap',
		createParser: () => (view) => ({ heartRate: view.getUint8(1) }),
	});
	sensor.onReading((r) => readings.push(r));
	sensor.onStatus((s) => statuses.push(s));
	return { sensor, readings, statuses };
}

beforeEach(() => {
	vi.useFakeTimers();
	device = new FakeDevice();
	Object.defineProperty(navigator, 'bluetooth', {
		configurable: true,
		value: { requestDevice: async () => device },
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe('a BLE sensor that drops (#1716)', () => {
	it('reattaches with backoff instead of going quietly idle', async () => {
		const { sensor, readings, statuses } = makeSensor();
		await sensor.connect();

		expect(sensor.status).toBe('connected');
		device.characteristic.notify([0x00, 142]);
		expect(readings.at(-1)?.heartRate).toBe(142);

		device.drop();
		// Not 'disconnected': the card would read that as never paired, and a
		// strap losing contact is a fault the rider is told about.
		expect(sensor.status).toBe('connecting');

		await vi.advanceTimersByTimeAsync(1000);
		expect(sensor.status).toBe('connected');
		expect(statuses).toEqual([
			'connecting',
			'connected',
			'connecting',
			'connected',
		]);

		device.characteristic.notify([0x00, 138]);
		expect(readings.at(-1)?.heartRate).toBe(138);
	});

	it('delivers one reading per packet after reattaching, not two', async () => {
		const { sensor, readings } = makeSensor();
		await sensor.connect();
		device.drop();
		await vi.advanceTimersByTimeAsync(1000);

		device.characteristic.notify([0x00, 150]);
		expect(readings).toHaveLength(1);
		// The previous attach's listener is dropped, not merely outnumbered.
		expect(device.characteristic.live).toBe(1);
	});

	it('backs off when the reattach itself fails, and keeps trying', async () => {
		const { sensor } = makeSensor();
		await sensor.connect();
		device.failConnects = 2;
		device.drop();

		await vi.advanceTimersByTimeAsync(1000);
		expect(sensor.status).toBe('connecting');
		// Doubling: nothing happens at +1 s, the second retry is at +2 s.
		await vi.advanceTimersByTimeAsync(999);
		expect(device.connects).toBe(2);
		await vi.advanceTimersByTimeAsync(1001);
		expect(sensor.status).toBe('connecting');
		await vi.advanceTimersByTimeAsync(4000);
		expect(sensor.status).toBe('connected');
	});

	it('stands the retry loop down when the rider unpairs', async () => {
		const { sensor } = makeSensor();
		await sensor.connect();

		await sensor.disconnect();
		expect(sensor.status).toBe('disconnected');
		expect(device.disconnects).toBe(1);

		// The stack fires the drop event on a deliberate hang-up too.
		device.drop();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(sensor.status).toBe('disconnected');
		expect(device.connects).toBe(1);
	});

	it('drops the previous attach when reattaching, so packets stop once', async () => {
		const { sensor, readings } = makeSensor();
		await sensor.connect();
		device.drop();
		await vi.advanceTimersByTimeAsync(1000);
		await sensor.disconnect();

		device.characteristic.notify([0x00, 99]);
		expect(readings).toHaveLength(0);
	});
});
