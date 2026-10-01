import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulatedTrainer } from '$lib/ble/simulated';
import { GEARS_PROBE } from './gears-probe-steps';
import {
	runProbeStep,
	writesPerShift,
	type ProbeEvent,
	type StepId,
} from './gears-probe';

/**
 * The Gears probe's dry run (#3331): every step, end to end, against the
 * SimulatedTrainer (#3050), holding 85 rpm in one real gear as the sitting
 * asks — so the probe is known to work before anyone sets up a Kickr.
 */
describe('the Gears probe on the SimulatedTrainer', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	async function dryRun(id: StepId) {
		const trainer = new SimulatedTrainer({ cadence: 85, rng: () => 0.5 });
		await trainer.connect();
		const events: ProbeEvent[] = [];
		const step = GEARS_PROBE.find((s) => s.id === id)!;
		// The simulator ticks for ever, so time is stepped until the step settles.
		let done = false;
		void runProbeStep(step, trainer, (e) => events.push(e)).then(
			() => (done = true),
		);
		for (let i = 0; i < 4_000 && !done; i++)
			await vi.advanceTimersByTimeAsync(1_000);
		expect(done, `${id} never finished`).toBe(true);
		await trainer.disconnect();
		return { trainer, events };
	}

	it.each(GEARS_PROBE.filter((s) => s.run).map((s) => s.id))(
		'runs %s, logging every write with the whole road, the wheel, k and the time',
		async (id) => {
			const { trainer, events } = await dryRun(id);
			const writes = events.filter((e) => e.kind === 'write');
			expect(writes.length).toBeGreaterThan(0);
			for (const write of writes)
				for (const field of [
					'op',
					'grade',
					'crr',
					'cw',
					'wind',
					'circumference',
					'k',
					'ms',
				] as const)
					expect(
						Number.isFinite(write[field]),
						`${id} ${field}: ${JSON.stringify(write)}`,
					).toBe(true);
			// What was logged is what the trainer took, write for write.
			expect(writes.map((w) => w.op)).toEqual(
				trainer.writes.map((w) =>
					w.op === 'erg' ? 0x05 : w.op === 'sim' ? 0x11 : 0x12,
				),
			);
			expect(events.some((e) => e.kind === 'sample')).toBe(true);
		},
	);

	it("reads the simulated rider's 34×14 within P1's ±5 %", async () => {
		const { events } = await dryRun('P1');
		const last = events.findLast((e) => e.kind === 'sample');
		expect(last?.kind === 'sample' && last.ratio).toBeCloseTo(34 / 14, 1);
		const ratio = last?.kind === 'sample' ? last.ratio! : 0;
		expect(Math.abs(ratio / (34 / 14) - 1)).toBeLessThan(0.05);
	});

	it('writes exactly one 0x11 per P6 shift (P7), up and down, at both steps', async () => {
		const { events } = await dryRun('P6');
		const counts = writesPerShift(events);
		expect(counts).toHaveLength(40);
		expect(counts.every((n) => n === 1)).toBe(true);
		const ks = events.flatMap((e) => (e.kind === 'shift' ? [e.k] : []));
		expect(ks.slice(0, 2)).toEqual([1.0907, 1]);
		expect(ks.slice(20, 22)).toEqual([1.5, 1]);
	});

	it('lands a burst on the gear it asked for, with no more writes than presses (P8)', async () => {
		const { events } = await dryRun('P8');
		const presses = events.filter((e) => e.kind === 'press');
		expect(presses).toHaveLength(15);
		const after = events.slice(events.indexOf(presses[0]));
		const writes = after.filter((e) => e.kind === 'write' && e.op === 0x11);
		expect(writes.length).toBeLessThanOrEqual(presses.length);
		// Up five, down five, up five: the last write is five gears up.
		const last = writes.at(-1)!;
		expect(last.kind === 'write' && last.k).toBeCloseTo(1.0907 ** 5, 6);
	});
});
