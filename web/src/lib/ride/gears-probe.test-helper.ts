import { expect, vi } from 'vitest';
import type { Trainer } from '$lib/ble/trainer';
import { GEARS_PROBE } from './gears-probe-steps';
import { runProbeStep, type ProbeEvent, type StepId } from './gears-probe';

/**
 * One Gears probe step, end to end, against a trainer it connects, under
 * fake timers. Time is stepped a second at a time until the step settles, since
 * a simulated trainer ticks for ever.
 */
export async function dryRunOn<T extends Trainer>(
	trainer: T,
	id: StepId,
): Promise<{ trainer: T; events: ProbeEvent[] }> {
	// An FTMS connect waits for its control grant's indication, on a timer.
	let up = false;
	const connecting = trainer.connect().then(() => (up = true));
	for (let i = 0; i < 1_000 && !up; i++)
		await vi.advanceTimersByTimeAsync(i === 0 ? 0 : 10);
	await connecting;
	const events: ProbeEvent[] = [];
	const step = GEARS_PROBE.find((s) => s.id === id)!;
	let done = false;
	void runProbeStep(step, trainer, (e) => events.push(e)).then(
		() => (done = true),
	);
	for (let i = 0; i < 4_000 && !done; i++)
		await vi.advanceTimersByTimeAsync(1_000);
	expect(done, `${id} never finished`).toBe(true);
	const gone = trainer.disconnect();
	await vi.advanceTimersByTimeAsync(500);
	await gone;
	return { trainer, events };
}
