import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulatedTrainer } from './simulated';
import type { TrainerSample, TrainerStatus } from './trainer';

// deterministic rng: fixed mid-range value → zero-centered noise becomes 0
const flatRng = () => 0.5;

function collect(t: SimulatedTrainer) {
	const samples: TrainerSample[] = [];
	const statuses: TrainerStatus[] = [];
	t.onSample((s) => samples.push(s));
	t.onStatus((s) => statuses.push(s));
	return { samples, statuses };
}

describe('SimulatedTrainer', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('emits ~1 Hz samples once connected', async () => {
		const t = new SimulatedTrainer({ rng: flatRng });
		const { samples, statuses } = collect(t);
		await t.connect();
		vi.advanceTimersByTime(5000);
		expect(samples).toHaveLength(5);
		expect(statuses).toEqual(['connecting', 'connected']);
	});

	it('converges to the ERG target within a few time constants', async () => {
		const t = new SimulatedTrainer({ rng: flatRng, tauSeconds: 2 });
		collect(t);
		await t.connect();
		await t.setTargetPower(250);
		vi.advanceTimersByTime(10_000);
		// after 5×tau the lag term is <1% — expect within noise of target
		const last = lastSample(t);
		expect(last.watts).toBeGreaterThan(240);
		expect(last.watts).toBeLessThanOrEqual(255);
	});

	it('sim mode: power rises with grade and falls below base when descending', async () => {
		const t = new SimulatedTrainer({
			rng: flatRng,
			baseWatts: 200,
			tauSeconds: 1,
		});
		collect(t);
		await t.connect();
		await t.setSimulation(5);
		vi.advanceTimersByTime(8000);
		expect(t.mode).toBe('sim');
		const climbing = lastSample(t).watts;
		expect(climbing).toBeGreaterThan(250); // 200 × (1 + 0.08×5) = 280

		await t.setSimulation(-5);
		vi.advanceTimersByTime(8000);
		expect(lastSample(t).watts).toBeLessThan(150); // 200 × 0.6 = 120
	});

	it('cadence follows power and is 0 when stopped', async () => {
		const t = new SimulatedTrainer({ rng: flatRng });
		collect(t);
		await t.connect();
		await t.setTargetPower(0);
		vi.advanceTimersByTime(20_000);
		expect(lastSample(t).cadence).toBe(0);
		await t.setTargetPower(300);
		vi.advanceTimersByTime(20_000);
		const c = lastSample(t).cadence;
		expect(c).toBeGreaterThanOrEqual(60);
		expect(c).toBeLessThanOrEqual(110);
	});

	it('dropout: samples stop, status dips to connecting, then recovers', async () => {
		const t = new SimulatedTrainer({ rng: flatRng });
		const { samples, statuses } = collect(t);
		await t.connect();
		vi.advanceTimersByTime(2000);
		const before = samples.length;
		t.simulateDropout(3000);
		vi.advanceTimersByTime(3000);
		expect(samples.length).toBe(before); // silence during dropout
		vi.advanceTimersByTime(2000);
		expect(samples.length).toBeGreaterThan(before); // recovered
		expect(statuses).toEqual([
			'connecting',
			'connected',
			'connecting',
			'connected',
		]);
	});

	it('control writes throw when not connected; unsubscribe stops callbacks', async () => {
		const t = new SimulatedTrainer({ rng: flatRng });
		await expect(t.setTargetPower(200)).rejects.toThrow('not connected');

		const samples: TrainerSample[] = [];
		const unsub = t.onSample((s) => samples.push(s));
		await t.connect();
		vi.advanceTimersByTime(2000);
		unsub();
		vi.advanceTimersByTime(2000);
		expect(samples).toHaveLength(2);
	});
});

function lastSample(t: SimulatedTrainer): TrainerSample {
	let last: TrainerSample | undefined;
	const unsub = t.onSample((s) => (last = s));
	vi.advanceTimersByTime(1000);
	unsub();
	if (!last) throw new Error('no sample emitted');
	return last;
}
