import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GEAR_INPUTS } from '#lib/ride/gears-enabled.ts';
import { bindShiftController } from '#lib/ride/keys.ts';
import { createRideShift } from '#lib/ride/ride-shift.ts';
import { shifterSlot } from './controller-slot.svelte';
import { WATTROOM_APP_INFO, type ObcAction, type ObcEdge } from './obc';
import {
	createObcNetController,
	obcNet,
	type NetShifter,
	type ObcNetBridge,
} from './obc-net.svelte';

vi.mock('#lib/sound/cues.ts', () => ({ play: () => {} }));
const dev = vi.hoisted(() => ({ on: true }));
vi.mock('#lib/ble/can-simulate.ts', () => ({ canSimulate: () => dev.on }));

/**
 * The desktop shell's `window.wattroom.obc`, as preload.js exposes it: a
 * socket that answers connect, and the bytes a controller sends (MDNS.md).
 */
class FakeShell implements ObcNetBridge {
	written: Uint8Array[] = [];
	connects: string[] = [];
	closes = 0;
	refuse: string | null = null;
	private found?: (f: { devices: NetShifter[]; denied: boolean }) => void;
	private data?: (bytes: Uint8Array) => void;
	private closed?: () => void;

	browse(cb: (f: { devices: NetShifter[]; denied: boolean }) => void) {
		this.found = cb;
	}
	async connect(id: string) {
		this.connects.push(id);
		return this.refuse ? { error: this.refuse } : { name: 'BikeControl' };
	}
	onData(cb: (bytes: Uint8Array) => void) {
		this.data = cb;
	}
	onClosed(cb: () => void) {
		this.closed = cb;
	}
	write(bytes: Uint8Array) {
		this.written.push(bytes);
	}
	close() {
		this.closes++;
	}
	/** The shell heard this on the network. */
	announce(devices: NetShifter[], denied = false) {
		this.found?.({ devices, denied });
	}
	/** One TCP read from the controller. */
	send(...bytes: number[]) {
		this.data?.(Uint8Array.of(...bytes));
	}
	/** The socket closed under us. */
	drop() {
		this.closed?.();
	}
}

const BIKECONTROL = {
	id: 'BikeControl._openbikecontrol._tcp.local',
	name: 'BikeControl',
};
// One shell per page, as the bridge is: obcNet.start() subscribes once.
const shell = new FakeShell();
(globalThis as { wattroom?: unknown }).wattroom = { obc: shell };
obcNet.start();

beforeEach(() => {
	shell.written = [];
	shell.connects = [];
	shell.closes = 0;
	shell.refuse = null;
	dev.on = true;
});
afterEach(async () => {
	await shifterSlot.forget();
	vi.useRealTimers();
});

describe('an OpenBikeControl controller over the network (#3336)', () => {
	it('lists what the shell finds, and a refused Local Network', () => {
		shell.announce([BIKECONTROL]);
		expect(obcNet.available).toBe(true);
		expect(obcNet.found).toEqual([BIKECONTROL]);
		expect(obcNet.denied).toBe(false);
		shell.announce([], true);
		expect(obcNet.found).toEqual([]);
		expect(obcNet.denied).toBe(true);
	});

	it('connects to the one it was given, then tells it the buttons', async () => {
		const controller = createObcNetController(BIKECONTROL);
		await controller.connect();
		expect(shell.connects).toEqual([BIKECONTROL.id]);
		expect(controller.status).toBe('connected');
		expect(controller.name).toBe('BikeControl');
		expect(shell.written).toEqual([WATTROOM_APP_INFO]);
	});

	it('turns reads into action edges, a release glued to status included', async () => {
		const controller = createObcNetController(BIKECONTROL);
		const seen: [ObcAction, ObcEdge][] = [];
		controller.onAction((action, edge) => seen.push([action, edge]));
		await controller.connect();
		shell.send(0x01, 0x02, 0x01);
		shell.send(0x01, 0x02, 0x00, 0x02, 0x55, 0x01);
		expect(seen).toEqual([
			['easier', 'down'],
			['easier', 'up'],
		]);
	});

	it('says what the shell said when it cannot connect', async () => {
		shell.refuse = 'BikeControl did not answer. Check it is open, then Retry.';
		await shifterSlot.pair(
			() => createObcNetController(BIKECONTROL),
			'obc-net',
		);
		expect(shifterSlot.status).toBe('disconnected');
		expect(shifterSlot.error).toBe(shell.refuse);
	});

	it('drops every hold when the socket closes, then reconnects and re-sends its buttons', async () => {
		vi.useFakeTimers();
		const controller = createObcNetController(BIKECONTROL);
		const seen: [ObcAction, ObcEdge][] = [];
		controller.onAction((action, edge) => seen.push([action, edge]));
		await controller.connect();
		shell.send(0x01, 0x01, 0x01);
		shell.drop();
		expect(seen).toEqual([
			['harder', 'down'],
			['harder', 'drop'],
		]);
		expect(controller.status).toBe('connecting');
		await vi.advanceTimersByTimeAsync(1000);
		expect(controller.status).toBe('connected');
		expect(shell.connects).toHaveLength(2);
		expect(shell.written).toEqual([WATTROOM_APP_INFO, WATTROOM_APP_INFO]);
		await controller.disconnect();
	});

	it('closes the socket on forget, and reconnects no more', async () => {
		vi.useFakeTimers();
		await shifterSlot.pair(
			() => createObcNetController(BIKECONTROL),
			'obc-net',
		);
		await shifterSlot.forget();
		expect(shell.closes).toBe(1);
		shell.drop();
		await vi.advanceTimersByTimeAsync(5000);
		expect(shell.connects).toHaveLength(1);
	});
});

describe('a network shifter shifts the ride, behind its own switch (#3336)', () => {
	beforeEach(() => vi.useFakeTimers());

	async function ride(inputs = GEAR_INPUTS) {
		await shifterSlot.pair(
			() => createObcNetController(BIKECONTROL),
			'obc-net',
		);
		let gear = 0;
		const shift = createRideShift(
			{
				easierHarder: (dir) => ((gear += dir), { moved: true }),
				atEnd: () => false,
			},
			undefined,
			() => Date.now(),
			inputs,
		);
		const unbind = bindShiftController(shift);
		return {
			get gear() {
				return gear;
			},
			stop() {
				unbind();
				shift.stop();
			},
		};
	}

	it('shifts one gear a tap at the dev gate, and buzzes the controller', async () => {
		const r = await ride();
		shell.written = [];
		shell.send(0x01, 0x01, 0x01);
		shell.send(0x01, 0x01, 0x00);
		expect(r.gear).toBe(1);
		expect(shell.written).toEqual([Uint8Array.of(0x03, 0x01, 0, 0)]);
		r.stop();
	});

	it('shifts nothing for a rider past the dev gate, or with its switch off', async () => {
		dev.on = false;
		const r = await ride();
		shell.send(0x01, 0x01, 0x01);
		shell.send(0x01, 0x01, 0x00);
		expect(r.gear).toBe(0);
		r.stop();

		dev.on = true;
		const off = await ride({ ...GEAR_INPUTS, 'obc-net': false });
		shell.send(0x01, 0x01, 0x01);
		shell.send(0x01, 0x01, 0x00);
		expect(off.gear).toBe(0);
		off.stop();
	});

	it('leaves the Web Bluetooth switch alone', async () => {
		const r = await ride({ ...GEAR_INPUTS, obc: false });
		shell.send(0x01, 0x01, 0x01);
		shell.send(0x01, 0x01, 0x00);
		expect(r.gear).toBe(1);
		r.stop();
	});
});
