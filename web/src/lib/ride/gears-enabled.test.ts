import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CueId } from '$lib/sound/cue-catalogue';
import {
	GEAR_INPUTS,
	gearsEnabled,
	inputOf,
	type GearInput,
} from './gears-enabled';
import { createRideShift } from './ride-shift';

// A production rider (#3333): no dev build, no dev sign-in door, so no
// simulated trainer, the gate gears used to share with it.
vi.mock('$lib/ble/can-simulate', () => ({ canSimulate: () => false }));

const INPUTS = Object.keys(GEAR_INPUTS) as GearInput[];

describe('gears reach every rider (#3333, ADR-0088)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('has every landed input on in production: the pair, the keys and the phone', () => {
		expect(INPUTS).toEqual(['screen', 'keys', 'phone']);
		for (const input of INPUTS) expect(gearsEnabled(input)).toBe(true);
		expect(gearsEnabled()).toBe(true);
	});

	it.each(INPUTS)('switches %s off alone, leaving the others on', (off) => {
		const inputs = { ...GEAR_INPUTS, [off]: false };
		for (const input of INPUTS)
			expect(gearsEnabled(input, inputs)).toBe(input !== off);
		expect(gearsEnabled(undefined, inputs)).toBe(true);
	});

	it('names the input of every source the shifter hears', () => {
		expect(inputOf('screen:1')).toBe('screen');
		expect(inputOf('key:Period')).toBe('keys');
		expect(inputOf('key:NumpadAdd')).toBe('keys');
		expect(inputOf('remote')).toBe('phone');
	});

	it('shifts a production ride from the pair, a key and the phone', () => {
		const cues: CueId[] = [];
		let gear = 0;
		const shift = createRideShift(
			{
				easierHarder: (dir) => ((gear += dir), { moved: true }),
				atEnd: () => false,
			},
			(id) => cues.push(id),
			() => Date.now(),
		);
		for (const source of ['screen:1', 'key:Equal', 'remote']) {
			shift.press(1, source);
			shift.release(source);
			vi.advanceTimersByTime(1_000);
		}
		shift.stop();
		expect(gear).toBe(3);
		expect(cues).toEqual(['shift-up', 'shift-up', 'shift-up']);
	});
});
