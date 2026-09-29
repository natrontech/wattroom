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

	it('sim mode: a rider holding cadence pushes harder uphill and freewheels down', async () => {
		const t = new SimulatedTrainer({
			rng: flatRng,
			cadence: 90,
			tauSeconds: 1,
		});
		collect(t);
		await t.connect();
		await t.setSimulation({ gradePct: 5 });
		vi.advanceTimersByTime(8000);
		expect(t.mode).toBe('sim');
		expect(lastSample(t).watts).toBeGreaterThan(400);

		await t.setSimulation({ gradePct: -5 });
		vi.advanceTimersByTime(8000);
		expect(lastSample(t).watts).toBeLessThan(20);
	});

	it('sim mode: a rider holding power keeps it, and the road sets the speed', async () => {
		const t = new SimulatedTrainer({
			rng: flatRng,
			baseWatts: 200,
			tauSeconds: 1,
		});
		collect(t);
		await t.connect();
		await t.setSimulation({ gradePct: 0 });
		vi.advanceTimersByTime(60_000);
		const flat = lastSample(t);
		await t.setSimulation({ gradePct: 6 });
		vi.advanceTimersByTime(60_000);
		const climb = lastSample(t);
		expect(flat.watts).toBe(200);
		expect(climb.watts).toBe(200);
		expect(climb.speedMps!).toBeLessThan(flat.speedMps! / 2);
		// One gear: slower wheel, slower legs.
		expect(climb.cadence).toBeLessThan(flat.cadence);
	});

	it('reports the flywheel speed through its real gear', async () => {
		const t = new SimulatedTrainer({ rng: flatRng, cadence: 90 });
		collect(t);
		await t.connect();
		await t.setSimulation({ gradePct: 2 });
		vi.advanceTimersByTime(5000);
		// 90 rpm × 34/14 × 2.096 m = 7.64 m/s (27.5 km/h)
		expect(lastSample(t).speedMps).toBeCloseTo(
			(90 / 60) * (34 / 14) * 2.096,
			6,
		);

		const small = new SimulatedTrainer({
			rng: flatRng,
			cadence: 90,
			ratio: { chainring: 34, cog: 28 },
		});
		collect(small);
		await small.connect();
		await small.setSimulation({ gradePct: 2 });
		vi.advanceTimersByTime(5000);
		expect(lastSample(small).speedMps).toBeCloseTo(
			lastSample(t).speedMps! / 2,
			6,
		);
	});

	it.each([
		['a steeper grade', { gradePct: 4 }],
		['more rolling resistance', { gradePct: 0, crr: 0.012 }],
		['more wind resistance', { gradePct: 0, cw: 0.9 }],
		['a head wind', { gradePct: 0, windMps: 5 }],
	])('sim mode: %s slows a rider holding power', async (_, road) => {
		const ride = async (
			sim: Parameters<SimulatedTrainer['setSimulation']>[0],
		) => {
			const t = new SimulatedTrainer({ rng: flatRng, baseWatts: 200 });
			collect(t);
			await t.connect();
			await t.setSimulation(sim);
			vi.advanceTimersByTime(120_000);
			return lastSample(t).speedMps!;
		};
		expect(await ride(road)).toBeLessThan(await ride({ gradePct: 0 }));
	});

	it('sim mode: more resistance at the same cadence is more watts, as a shift is', async () => {
		const ride = async (cw: number) => {
			const t = new SimulatedTrainer({ rng: flatRng, cadence: 90 });
			collect(t);
			await t.connect();
			await t.setSimulation({ gradePct: 2, cw });
			vi.advanceTimersByTime(20_000);
			return lastSample(t).watts;
		};
		expect(await ride(0.9)).toBeGreaterThan((await ride(0.51)) + 50);
	});

	it('logs every control write, SIM with its defaults resolved', async () => {
		const t = new SimulatedTrainer({ rng: flatRng });
		await t.connect();
		await t.setTargetPower(200);
		await t.setSimulation({ gradePct: 4, cw: 0.33 });
		expect(t.writes).toEqual([
			{ op: 'erg', watts: 200 },
			{ op: 'sim', gradePct: 4, crr: 0.004, cw: 0.33, windMps: 0 },
		]);
		expect(t.road).toEqual({ gradePct: 4, crr: 0.004, cw: 0.33, windMps: 0 });
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
		// Strictly inside the dropout, and strictly past it. Landing on the
		// instant it ends makes the assertion depend on which of two timers due
		// at the same virtual millisecond runs first — the interval that emits a
		// sample, or the timeout that ends the dropout. vitest 5 reversed that
		// tie-break, and the trainer's behaviour did not change (#2346).
		vi.advanceTimersByTime(2500);
		expect(samples.length).toBe(before); // silence during dropout
		vi.advanceTimersByTime(2500);
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
