// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GEAR_INPUTS } from '$lib/ride/gears-enabled';
import { bindShiftController } from '$lib/ride/keys';
import { createRideShift } from '$lib/ride/ride-shift';
import type { CueId } from '$lib/sound/cue-catalogue';
import { shifterSlot } from './controller-slot.svelte';
import { createObcController } from './controller';
import { FakeObcDevice } from './fake-gatt.test-helper';
import { OBC, WATTROOM_APP_INFO, type ObcAction, type ObcEdge } from './obc';

vi.mock('$lib/sound/cues', () => ({ play: () => {} }));

let device: FakeObcDevice;
let asked: RequestDeviceOptions[];

function pairWith(next: FakeObcDevice) {
	device = next;
	asked = [];
	Object.defineProperty(navigator, 'bluetooth', {
		configurable: true,
		value: {
			requestDevice: async (options: RequestDeviceOptions) => {
				asked.push(options);
				return device;
			},
		},
	});
}

beforeEach(() => pairWith(new FakeObcDevice()));
afterEach(async () => {
	await shifterSlot.forget();
	vi.useRealTimers();
});

describe('an OpenBikeControl controller over Web Bluetooth (#3335)', () => {
	it('asks for the OBC service, then tells the controller its buttons', async () => {
		const controller = createObcController();
		await controller.connect();
		expect(asked).toEqual([{ filters: [{ services: [OBC.service] }] }]);
		expect(controller.status).toBe('connected');
		expect(controller.name).toBe('Fake OBC');
		expect(device.buttonState.notifying).toBe(true);
		expect(device.appInfo.writes).toEqual([WATTROOM_APP_INFO]);
	});

	it('turns notifications into action edges', async () => {
		const controller = createObcController();
		const seen: [ObcAction, ObcEdge][] = [];
		controller.onAction((action, edge) => seen.push([action, edge]));
		await controller.connect();
		device.press(0x01, 0x02, 0x01);
		device.press(0x01, 0x02, 0x00);
		expect(seen).toEqual([
			['easier', 'down'],
			['easier', 'up'],
		]);
	});

	it('buzzes without response, and a controller without a motor still pairs', async () => {
		const controller = createObcController();
		await controller.connect();
		controller.feel('shift');
		expect(device.haptic.writes).toEqual([Uint8Array.of(0x03, 0x01, 0, 0)]);

		pairWith(new FakeObcDevice(false));
		const quiet = createObcController();
		await quiet.connect();
		expect(quiet.status).toBe('connected');
		expect(() => quiet.feel('end')).not.toThrow();
	});

	it('drops every hold when the link goes, then reattaches and re-sends its buttons', async () => {
		vi.useFakeTimers();
		const controller = createObcController();
		const seen: [ObcAction, ObcEdge][] = [];
		controller.onAction((action, edge) => seen.push([action, edge]));
		await controller.connect();
		device.press(0x01, 0x01, 0x01);
		device.drop();
		expect(seen).toEqual([
			['harder', 'down'],
			['harder', 'drop'],
		]);
		expect(controller.status).toBe('connecting');
		await vi.advanceTimersByTimeAsync(1000);
		expect(controller.status).toBe('connected');
		expect(device.connects).toBe(2);
		expect(device.appInfo.writes).toHaveLength(2);
	});
});

describe('a paired shifter shifts the ride (#3335)', () => {
	beforeEach(() => vi.useFakeTimers());

	/** A ride on the paired controller, with its gear, cues and the switches. */
	async function ride(inputs = GEAR_INPUTS) {
		await shifterSlot.pair();
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
		const unbind = bindShiftController(shift);
		return {
			cues,
			get gear() {
				return gear;
			},
			stop() {
				unbind();
				shift.stop();
			},
		};
	}

	it('shifts on Shift Up and Shift Down, one gear a tap', async () => {
		const r = await ride();
		device.press(0x01, 0x01, 0x01);
		device.press(0x01, 0x01, 0x00);
		vi.advanceTimersByTime(1000);
		device.press(0x01, 0x31, 0x01);
		device.press(0x01, 0x31, 0x00);
		expect(r.gear).toBe(0);
		expect(r.cues).toEqual(['shift-up', 'shift-down']);
		r.stop();
	});

	it('stops repeating a held Harder the moment the link drops', async () => {
		const r = await ride();
		device.press(0x01, 0x01, 0x01);
		vi.advanceTimersByTime(700);
		const held = r.gear;
		expect(held).toBeGreaterThan(1);
		device.drop();
		vi.advanceTimersByTime(2000);
		expect(r.gear).toBe(held);
		r.stop();
	});

	it('shifts nothing once its own switch is off', async () => {
		const r = await ride({ ...GEAR_INPUTS, obc: false });
		device.press(0x01, 0x01, 0x01);
		device.press(0x01, 0x01, 0x00);
		expect(r.gear).toBe(0);
		expect(r.cues).toEqual([]);
		r.stop();
	});

	it('buzzes the controller on a shift by default', async () => {
		await shifterSlot.pair();
		const shift = createRideShift({
			easierHarder: () => ({ moved: true }),
			atEnd: () => false,
		});
		shift.press(1, 'screen:1');
		shift.release('screen:1');
		expect(device.haptic.writes).toEqual([Uint8Array.of(0x03, 0x01, 0, 0)]);
		shift.stop();
	});

	it('says why a pairing failed, and forgets cleanly', async () => {
		Object.defineProperty(navigator, 'bluetooth', {
			configurable: true,
			value: {
				requestDevice: async () => {
					throw new DOMException('cancelled', 'NotFoundError');
				},
			},
		});
		await shifterSlot.pair();
		expect(shifterSlot.status).toBe('disconnected');
		expect(shifterSlot.error).toMatch(/No device picked/);
		await shifterSlot.forget();
		expect(shifterSlot.error).toBeUndefined();
	});
});
