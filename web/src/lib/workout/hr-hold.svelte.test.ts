import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimulatedSensor } from '$lib/ble/simulated-sensor';
import { createHrHold } from './hr-hold.svelte';
import type { Segment } from './types';

const FTP = 250;

/** A steady step holding heart rate in a band. */
function holding(band: { hrLow?: number; hrHigh?: number }): Segment {
	return {
		kind: 'steady',
		startSeconds: 0,
		seconds: 3600,
		fromFraction: 0.6,
		toFraction: 0.6,
		hrHold: true,
		stepPath: [0],
		...band,
	};
}

/**
 * A rider on the simulated strap whose heart rate answers power (the gain
 * is the test's, not the product's), held by the controller for `minutes`.
 * Returns the watts and the heart rate of every second.
 */
async function ride(
	segment: Segment,
	target: number,
	minutes: number,
	opts: { gain?: number; drop?: number } = {},
) {
	const gain = opts.gain ?? 0.5;
	const hold = createHrHold(FTP);
	let watts = target;
	const strap = createSimulatedSensor('heart-rate', {
		rng: () => 0.5,
		restingBpm: 60 + gain * target,
		chase: () => 60 + gain * watts,
	});
	strap.onReading((r) => hold.reading(r.heartRate, Date.now()));
	await strap.connect();
	const trace: { watts: number; bpm: number; lost: boolean }[] = [];
	for (let s = 0; s < minutes * 60; s++) {
		if (s === opts.drop) await strap.disconnect();
		await vi.advanceTimersByTimeAsync(1000);
		hold.tick(segment, Date.now());
		watts = hold.watts(segment, target);
		trace.push({ watts, bpm: 60 + gain * watts, lost: hold.lost });
	}
	await strap.disconnect();
	return trace;
}

describe('HR hold (#67, docs/SPEC.md)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('settles inside the band within 10 min and then swings no more than ±4 % FTP', async () => {
		// 150 W is 135 bpm on this rider; the band asks for 140–144.
		const trace = await ride(holding({ hrLow: 140, hrHigh: 144 }), 150, 30);
		const settled = trace.slice(10 * 60);
		for (const s of settled) {
			expect(s.bpm).toBeGreaterThanOrEqual(140 - 1);
			expect(s.bpm).toBeLessThanOrEqual(144 + 1);
		}
		const watts = settled.map((s) => s.watts);
		const mid = (Math.max(...watts) + Math.min(...watts)) / 2;
		for (const w of watts)
			expect(Math.abs(w - mid)).toBeLessThanOrEqual(0.04 * FTP);
	});

	it('stays inside ±10 % FTP of the target whatever heart rate says', async () => {
		// A heart rate the band can never reach: the window is the limit.
		const trace = await ride(holding({ hrLow: 200 }), 150, 30);
		for (const s of trace) {
			expect(s.watts).toBeLessThanOrEqual(150 + 0.1 * FTP);
			expect(s.watts).toBeGreaterThanOrEqual(150 - 0.1 * FTP);
		}
		expect(trace.at(-1)!.watts).toBe(150 + 0.1 * FTP);
	});

	it('treats a ceiling alone as a cap: it lowers the watts and never raises them past the target', async () => {
		const trace = await ride(holding({ hrHigh: 130 }), 150, 30);
		expect(Math.max(...trace.map((s) => s.watts))).toBe(150);
		expect(trace.at(-1)!.bpm).toBeLessThanOrEqual(131);
	});

	it('never raises the watts when the strap drops, and says so', async () => {
		// Below the band, so a live reading would raise; the strap goes 5 s
		// before the minute's adjustment.
		const trace = await ride(holding({ hrLow: 180 }), 150, 10, { drop: 115 });
		const atDrop = trace[114].watts;
		for (const s of trace.slice(115))
			expect(s.watts).toBeLessThanOrEqual(atDrop);
		expect(trace.at(-1)!.lost).toBe(true);
	});

	it('holds on an implausible reading', () => {
		const hold = createHrHold(FTP);
		const segment = holding({ hrLow: 150 });
		hold.tick(segment, 0);
		for (let s = 1; s <= 61; s++) {
			hold.reading(250, s * 1000); // outside 60–220 bpm
			hold.tick(segment, s * 1000);
		}
		expect(hold.watts(segment, 150)).toBe(150);
		expect(hold.lost).toBe(true);
	});

	it('leaves a step without a hold at its own target', () => {
		const hold = createHrHold(FTP);
		const plain = { ...holding({ hrLow: 150 }), hrHold: false };
		hold.tick(plain, 0);
		expect(hold.watts(plain, 150)).toBe(150);
		expect(hold.lost).toBe(false);
	});
});
