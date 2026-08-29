import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSimulatedSensor } from './simulated-sensor';
import type { SensorReading } from './sensor';

afterEach(() => vi.useRealTimers());

function collect(sensor: ReturnType<typeof createSimulatedSensor>) {
	const seen: SensorReading[] = [];
	sensor.onReading((r) => seen.push(r));
	return seen;
}

describe('createSimulatedSensor', () => {
	it('drifts heart rate toward the working rate instead of snapping', async () => {
		vi.useFakeTimers();
		const sensor = createSimulatedSensor('heart-rate', {
			restingBpm: 60,
			workingBpm: 160,
			tauSeconds: 20,
			rng: () => 0.5,
			now: () => 0,
		});
		const seen = collect(sensor);
		await sensor.connect();

		vi.advanceTimersByTime(1000);
		const first = seen[0].heartRate!;
		// One second of a 20 s time constant moves it a few bpm, not 100.
		expect(first).toBeGreaterThan(60);
		expect(first).toBeLessThan(70);

		vi.advanceTimersByTime(60_000);
		const later = seen.at(-1)!.heartRate!;
		expect(later).toBeGreaterThan(first);
		expect(later).toBeLessThanOrEqual(160);

		await sensor.disconnect();
	});

	it('reports watts and cadence for a power meter, and only cadence for a cadence sensor', async () => {
		vi.useFakeTimers();
		const meter = createSimulatedSensor('power-meter', {
			rng: () => 0.5,
			now: () => 0,
		});
		const meterSeen = collect(meter);
		await meter.connect();
		vi.advanceTimersByTime(1000);
		expect(meterSeen[0].watts).toBeDefined();
		expect(meterSeen[0].cadence).toBeDefined();
		expect(meterSeen[0].heartRate).toBeUndefined();
		await meter.disconnect();

		const cadence = createSimulatedSensor('cadence', {
			rng: () => 0.5,
			now: () => 0,
		});
		const cadenceSeen = collect(cadence);
		await cadence.connect();
		vi.advanceTimersByTime(1000);
		expect(cadenceSeen[0].cadence).toBeDefined();
		expect(cadenceSeen[0].watts).toBeUndefined();
		await cadence.disconnect();
	});

	it('stops reporting once disconnected', async () => {
		vi.useFakeTimers();
		const sensor = createSimulatedSensor('heart-rate', {
			rng: () => 0.5,
			now: () => 0,
		});
		const seen = collect(sensor);
		await sensor.connect();
		vi.advanceTimersByTime(2000);
		const count = seen.length;

		await sensor.disconnect();
		vi.advanceTimersByTime(5000);
		expect(seen.length).toBe(count);
	});
});
