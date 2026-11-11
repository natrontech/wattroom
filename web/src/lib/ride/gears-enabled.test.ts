import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CueId } from '#lib/sound/cue-catalogue.ts';
import {
	GEAR_INPUTS,
	gearsEnabled,
	inputOf,
	type GearInput,
} from './gears-enabled';
import { createRideShift } from './ride-shift';

// A production rider (#3333): no dev build, no dev sign-in door, so no
// simulated trainer. A gate that came back through canSimulate fails here.
// The network shifter waited at that gate (#3336) until #3349.
const dev = vi.hoisted(() => ({ on: false }));
vi.mock('#lib/ble/can-simulate.ts', () => ({ canSimulate: () => dev.on }));

const INPUTS = Object.keys(GEAR_INPUTS) as GearInput[];

describe('gears reach every rider (#3333, ADR-0088)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		dev.on = false;
	});

	it('has every input on in production: the pair, the keys, the phone, OBC and OBC over the network', () => {
		expect(INPUTS).toEqual(['screen', 'keys', 'phone', 'obc', 'obc-net']);
		for (const input of INPUTS) expect(gearsEnabled(input)).toBe(true);
		expect(gearsEnabled()).toBe(true);
	});

	// #3349: the network shifter, before its switch-on (dev gate only) and
	// after (every rider). Leaving it at the gate turns the production row red.
	it.each([
		{ rider: 'a production rider', dev: false, before: false, after: true },
		{ rider: 'a dev sign-in', dev: true, before: true, after: true },
	])('lets $rider shift over the network', ({ dev: on, before, after }) => {
		dev.on = on;
		const gated = { ...GEAR_INPUTS, 'obc-net': on };
		expect(gearsEnabled('obc-net', gated)).toBe(before);
		expect(gearsEnabled('obc-net')).toBe(after);
		expect(gearsEnabled(inputOf('obc-net:harder'))).toBe(after);
	});

	it.each(INPUTS)('switches %s off alone, leaving the others on', (off) => {
		const inputs = { ...GEAR_INPUTS, [off]: false };
		for (const input of INPUTS)
			expect(gearsEnabled(input, inputs)).toBe(input !== off);
		expect(gearsEnabled(undefined, inputs)).toBe(true);
	});

	it('names the input of every source the shifter hears, and of no other', () => {
		expect(inputOf('screen:1')).toBe('screen');
		expect(inputOf('key:Period')).toBe('keys');
		expect(inputOf('key:NumpadAdd')).toBe('keys');
		expect(inputOf('remote')).toBe('phone');
		expect(inputOf('obc:harder')).toBe('obc');
		expect(inputOf('obc-net:harder')).toBe('obc-net');
		expect(inputOf('controller')).toBeNull();
		expect(gearsEnabled(inputOf('controller'))).toBe(false);
	});

	/** Gears moved by one press from each source, with `inputs` as the switches. */
	function pressEach(inputs = GEAR_INPUTS) {
		const cues: CueId[] = [];
		let gear = 0;
		const shift = createRideShift(
			{
				easierHarder: (dir) => ((gear += dir), { moved: true }),
				atEnd: () => false,
			},
			(id) => cues.push(id),
			() => Date.now(),
			inputs,
		);
		for (const source of [
			'screen:1',
			'key:Equal',
			'remote',
			'obc:harder',
			'obc-net:harder',
		]) {
			shift.press(1, source);
			shift.release(source);
			vi.advanceTimersByTime(1_000);
		}
		shift.stop();
		return { gear, cues };
	}

	it('shifts a production ride from the pair, a key, the phone, a controller and the network', () => {
		expect(pressEach()).toEqual({
			gear: 5,
			cues: ['shift-up', 'shift-up', 'shift-up', 'shift-up', 'shift-up'],
		});
	});

	it.each(INPUTS)('drops a press from %s alone once it is off', (off) => {
		expect(pressEach({ ...GEAR_INPUTS, [off]: false }).gear).toBe(4);
	});
});
