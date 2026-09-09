// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Sensor, SensorReading, SensorStatus } from '$lib/ble/sensor';

/**
 * One strap at a time (#1716). Pairing over a live sensor used to attach the
 * new one without hanging up the old, and both kept writing into the same
 * slot — with `forget()` able to reach only the newer of the two.
 */
class FakeSensor implements Sensor {
	kind = 'heart-rate' as const;
	status: SensorStatus = 'disconnected';
	disconnects = 0;
	#readings: ((r: SensorReading) => void)[] = [];
	#statuses: ((s: SensorStatus) => void)[] = [];
	constructor(readonly name = 'Polar H10') {}
	async connect() {
		this.status = 'connected';
		for (const cb of this.#statuses) cb('connected');
	}
	async disconnect() {
		this.disconnects++;
		this.status = 'disconnected';
		for (const cb of this.#statuses) cb('disconnected');
	}
	onReading(cb: (r: SensorReading) => void) {
		this.#readings.push(cb);
		return () => {
			this.#readings = this.#readings.filter((other) => other !== cb);
		};
	}
	onStatus(cb: (s: SensorStatus) => void) {
		this.#statuses.push(cb);
		return () => {
			this.#statuses = this.#statuses.filter((other) => other !== cb);
		};
	}
	/** One packet, as the radio would deliver it. */
	beat(bpm: number) {
		for (const cb of this.#readings) cb({ at: Date.now(), heartRate: bpm });
	}
}

const built: FakeSensor[] = [];
vi.mock('$lib/ble/heartrate', () => ({
	createHeartRateSensor: () => {
		const sensor = new FakeSensor(`strap ${built.length + 1}`);
		built.push(sensor);
		return sensor;
	},
}));

const { sensors } = await import('./sensors.svelte');

describe('pairing a sensor over a live one', () => {
	it('hangs the first one up, so one slot has one sensor', async () => {
		await sensors.pair('heart-rate');
		await sensors.pair('heart-rate');

		const [first, second] = built;
		expect(first.disconnects).toBe(1);
		expect(sensors.slot('heart-rate').name).toBe(second.name);

		// The abandoned strap can no longer reach the card. Without the
		// release its notifications kept landing here, so whichever of the two
		// notified last won the reading.
		first.beat(199);
		expect(sensors.slot('heart-rate').latest).toBeUndefined();

		second.beat(142);
		expect(sensors.slot('heart-rate').latest?.heartRate).toBe(142);

		await sensors.forget('heart-rate');
		expect(second.disconnects).toBe(1);
	});
});
