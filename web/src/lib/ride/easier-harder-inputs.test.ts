// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	SimParams,
	Trainer,
	TrainerSample,
	TrainerStatus,
} from '$lib/ble/trainer';
import { DEFAULTS } from '$lib/workout/guards';
import { createActuator } from './actuation.svelte';
import { biasPress } from './easier-harder';
import { bindShiftKeys, createRemoteRunner } from './keys';
import { createRideShift } from './ride-shift';

// A production rider (#3333): gears no longer wait for the dev door.
vi.mock('$lib/ble/can-simulate', () => ({ canSimulate: () => false }));

/** A trainer that keeps its mode and what it was told. */
class Recorder implements Trainer {
	name = 'recorder';
	status: TrainerStatus = 'connected';
	mode: 'erg' | 'sim' = 'sim';
	async connect() {}
	async disconnect() {}
	async setTargetPower() {
		this.mode = 'erg';
	}
	async setSimulation(_: SimParams) {
		this.mode = 'sim';
	}
	onSample(_: (s: TrainerSample) => void) {
		return () => {};
	}
	onStatus(_: (s: TrainerStatus) => void) {
		return () => {};
	}
}

/**
 * A ride the way a session or your own workout wires it: its actuator, its
 * bias behind Easier / Harder in ERG, and the shifter every input presses.
 */
function ride(mode: 'erg' | 'sim') {
	const act = createActuator(() => new Recorder());
	let bias = 1;
	if (mode === 'erg') act.hold(200);
	else act.grade(3);
	const shift = createRideShift(
		{
			easierHarder: (dir) =>
				act.easierHarder(
					dir,
					biasPress(
						() => bias,
						(step) => (bias += step),
					),
				),
			atEnd: act.atEnd,
		},
		() => {},
		() => Date.now(),
	);
	return { act, shift, bias: () => bias };
}

const press = (key: 'PageUp' | 'PageDown') => {
	window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key }));
	window.dispatchEvent(new KeyboardEvent('keyup', { key, code: key }));
	vi.advanceTimersByTime(500);
};

describe('Easier / Harder from PgUp / PgDn and the phone (#3333, #4163)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('trims the bias in ERG from PgUp and PgDn, and leaves the gear', () => {
		const { act, shift, bias } = ride('erg');
		const unbind = bindShiftKeys(shift);
		press('PageUp');
		press('PageUp');
		expect(bias()).toBeCloseTo(1 + 2 * DEFAULTS.biasStep, 9);
		press('PageDown');
		expect(bias()).toBeCloseTo(1 + DEFAULTS.biasStep, 9);
		expect(act.gear.k).toBe(1);
		unbind();
		shift.stop();
	});

	it('shifts a gear in SIM from PgUp and PgDn, and leaves the bias', () => {
		const { act, shift, bias } = ride('sim');
		const unbind = bindShiftKeys(shift);
		press('PageUp');
		const up = act.gear.k;
		expect(up).toBeGreaterThan(1);
		press('PageDown');
		expect(act.gear.k).toBeLessThan(up);
		expect(bias()).toBe(1);
		unbind();
		shift.stop();
	});

	/** The phone's taps, through the runner the connection builds. */
	function phone(r: ReturnType<typeof ride>) {
		const trim = vi.fn();
		const runner = createRemoteRunner(
			{
				shifts: () => true,
				press: (dir, source) => r.shift.press(dir, source),
				release: (source) => r.shift.release(source),
				trim,
			},
			() => {},
		);
		return {
			trim,
			tap(action: 'easier' | 'harder') {
				runner.run({ action });
				vi.advanceTimersByTime(500);
			},
		};
	}

	it("trims the bias in ERG from the phone's Harder and Easier", () => {
		const r = ride('erg');
		const { tap, trim } = phone(r);
		tap('harder');
		expect(r.bias()).toBeCloseTo(1 + DEFAULTS.biasStep, 9);
		tap('easier');
		tap('easier');
		expect(r.bias()).toBeCloseTo(1 - DEFAULTS.biasStep, 9);
		expect(r.act.gear.k).toBe(1);
		expect(trim).not.toHaveBeenCalled();
		r.shift.stop();
	});

	it("shifts a gear in SIM from the phone's Harder and Easier", () => {
		const r = ride('sim');
		const { tap } = phone(r);
		tap('harder');
		const up = r.act.gear.k;
		expect(up).toBeGreaterThan(1);
		tap('easier');
		expect(r.act.gear.k).toBeLessThan(up);
		expect(r.bias()).toBe(1);
		r.shift.stop();
	});
});
