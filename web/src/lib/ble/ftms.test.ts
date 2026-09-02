import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	parseIndoorBikeData,
	clampTarget,
	DEFAULT_POWER_RANGE,
	FtmsTrainer,
	parsePowerRange,
} from './ftms';

/** Little-endian byte builder, so the cases read like the spec's field order. */
function packet(flags: number, ...bytes: number[]): DataView {
	return new DataView(
		Uint8Array.from([flags & 0xff, (flags >> 8) & 0xff, ...bytes]).buffer,
	);
}

describe('parseIndoorBikeData', () => {
	it('reads instantaneous power (bit 6, SINT16)', () => {
		// bit0 set = More Data = speed absent; bit6 = power.
		expect(parseIndoorBikeData(packet(0x0041, 0xfa, 0x00)).watts).toBe(250);
	});

	it('treats bit 0 as INVERTED — clear means speed IS present', () => {
		// RESEARCH.md §11. Getting this backwards shifts every later field by two bytes.
		const withSpeed = parseIndoorBikeData(
			packet(0x0040, 0xb8, 0x0b, 0xfa, 0x00),
		);
		expect(withSpeed.speedKph).toBeCloseTo(30);
		expect(withSpeed.watts).toBe(250);
	});

	it('reads cadence at half-rpm resolution (bit 2 normal, despite the spec typo)', () => {
		const data = parseIndoorBikeData(packet(0x0045, 0xb4, 0x00, 0xfa, 0x00));
		expect(data.cadence).toBe(90); // 180 half-rpm
		expect(data.watts).toBe(250);
	});

	it('skips average power before heart rate', () => {
		// flags: no speed | power | average power | heart rate
		const data = parseIndoorBikeData(
			packet(0x02c1, 0xfa, 0x00, 0x2c, 0x01, 0x9b),
		);
		expect(data.watts).toBe(250);
		expect(data.heartRate).toBe(155);
	});

	it('handles a full Kickr-style frame: speed, cadence, power', () => {
		const data = parseIndoorBikeData(
			packet(0x0044, 0xb8, 0x0b, 0xb4, 0x00, 0x2c, 0x01),
		);
		expect(data.speedKph).toBeCloseTo(30);
		expect(data.cadence).toBe(90);
		expect(data.watts).toBe(300);
	});

	it('reads negative power without wrapping', () => {
		// SINT16: coasting on some units reports slightly negative rather than zero.
		expect(parseIndoorBikeData(packet(0x0041, 0xf6, 0xff)).watts).toBe(-10);
	});
});

describe('parsePowerRange', () => {
	const view = (...bytes: number[]) =>
		new DataView(Uint8Array.of(...bytes).buffer);

	it('parses the Kickr Core bytes from the #43 dump', () => {
		// 0x2AD8 read on real hardware: min 0, max 2000 W, 1 W increment.
		expect(parsePowerRange(view(0x00, 0x00, 0xd0, 0x07, 0x01, 0x00))).toEqual({
			minWatts: 0,
			maxWatts: 2000,
			incrementWatts: 1,
		});
	});

	it('falls back on a short read — the 0x2A65 lesson applied here', () => {
		expect(parsePowerRange(view(0x0e, 0x12))).toEqual(DEFAULT_POWER_RANGE);
	});

	it('falls back on a nonsensical range rather than clamping to garbage', () => {
		// max <= min would turn every target into one number.
		expect(parsePowerRange(view(0xd0, 0x07, 0x00, 0x00, 0x01, 0x00))).toEqual(
			DEFAULT_POWER_RANGE,
		);
	});

	it('treats a zero increment as one rather than dividing by it', () => {
		const range = parsePowerRange(view(0x00, 0x00, 0xd0, 0x07, 0x00, 0x00));
		expect(range.incrementWatts).toBe(1);
	});
});

describe('clampTarget', () => {
	const core = { minWatts: 0, maxWatts: 2000, incrementWatts: 1 };

	it('passes normal targets through untouched', () => {
		expect(clampTarget(250, core)).toBe(250);
	});

	it('caps at the advertised maximum instead of stalling the write queue', () => {
		expect(clampTarget(2500, core)).toBe(2000);
	});

	it('floors at the advertised minimum', () => {
		expect(clampTarget(-50, core)).toBe(0);
		expect(clampTarget(30, { ...core, minWatts: 50 })).toBe(50);
	});

	it('rounds onto a coarser increment grid', () => {
		// A trainer advertising 10 W steps: 253 is not a writable target.
		expect(clampTarget(253, { ...core, incrementWatts: 10 })).toBe(250);
	});
});

/**
 * Minimal GATT fake: enough of a device/service/characteristic for FtmsTrainer to
 * attach to, plus a hand on how the trainer answers each control-point write —
 * acknowledge it, fail the write itself, or never answer at all.
 */
class FakeCharacteristic extends EventTarget {
	value?: DataView;
	notifying = false;
	/** Every frame that actually reached the device, in order. */
	writes: Uint8Array[] = [];
	/** How the trainer answers a write. Default: immediate success indication. */
	answer: (frame: Uint8Array) => 'ack' | 'fail' | 'silent' = () => 'ack';

	async startNotifications(): Promise<FakeCharacteristic> {
		this.notifying = true;
		return this;
	}

	async readValue(): Promise<DataView> {
		return this.value!;
	}

	async writeValueWithResponse(bytes: ArrayBuffer): Promise<void> {
		const frame = new Uint8Array(bytes);
		this.writes.push(frame);
		const answer = this.answer(frame);
		if (answer === 'fail') throw new Error('GATT operation failed');
		if (answer === 'ack') this.indicate(frame[0]);
	}

	/** The 0x80 response frame: response opcode, request opcode, result. */
	indicate(op: number, result = 0x01): void {
		this.notify(Uint8Array.of(0x80, op, result));
	}

	notify(bytes: Uint8Array): void {
		this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.dispatchEvent(new Event('characteristicvaluechanged'));
	}
}

class FakeDevice extends EventTarget {
	name = 'Fake Kickr';
	/** GATT connect count — the reattach loop's tell. */
	connects = 0;
	bikeData = new FakeCharacteristic();
	control = new FakeCharacteristic();
	machineStatus = new FakeCharacteristic();
	powerRange = new FakeCharacteristic();

	constructor() {
		super();
		// min 0 W, max 2000 W, 1 W increment — the #43 hardware dump.
		this.powerRange.value = new DataView(
			Uint8Array.of(0x00, 0x00, 0xd0, 0x07, 0x01, 0x00).buffer,
		);
	}

	// The browser hands back the same characteristic objects on every reattach,
	// which is what makes a leaked listener leak.
	#service = {
		getCharacteristic: async (uuid: number) => {
			const found = {
				0x2ad2: this.bikeData,
				0x2ad9: this.control,
				0x2ada: this.machineStatus,
				0x2ad8: this.powerRange,
			}[uuid];
			if (!found) throw new Error(`no characteristic 0x${uuid.toString(16)}`);
			return found;
		},
	};

	gatt = {
		connect: async () => {
			this.connects++;
			return { getPrimaryService: async () => this.#service };
		},
		disconnect: () => this.drop(),
	};

	/** What the browser does when the link goes away. */
	drop(): void {
		this.dispatchEvent(new Event('gattserverdisconnected'));
	}
}

const view = (frame: Uint8Array) =>
	new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

/** Watts of every Set Target Power (0x05) frame the device received. */
const targetsWritten = (control: FakeCharacteristic): number[] =>
	control.writes
		.filter((f) => f[0] === 0x05)
		.map((f) => view(f).getInt16(1, true));

const targetWatts = (frame: Uint8Array) => view(frame).getInt16(1, true);

describe('FtmsTrainer control-point queue', () => {
	let warn: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.useFakeTimers();
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	async function paired() {
		const device = new FakeDevice();
		vi.stubGlobal('navigator', {
			bluetooth: { requestDevice: async () => device },
		});
		const trainer = new FtmsTrainer();
		await trainer.connect();
		return { trainer, device, control: device.control };
	}

	it('runs the next queued write after one has failed', async () => {
		// The issue's reduction: with target-200 failing, 250 and 300 never reached
		// the trainer again for the rest of the session.
		const { trainer, control } = await paired();
		control.answer = (f) => (targetWatts(f) === 200 ? 'fail' : 'ack');

		const failed = trainer.setTargetPower(200);
		const next = trainer.setTargetPower(250);
		const last = trainer.setTargetPower(300);

		await expect(failed).rejects.toThrow();
		await next;
		await last;
		expect(targetsWritten(control)).toEqual([200, 250, 300]);
	});

	it('still rejects for the caller of the failing write', async () => {
		const { trainer, control } = await paired();
		control.answer = () => 'fail';
		await expect(trainer.setTargetPower(200)).rejects.toThrow(
			'GATT operation failed',
		);
	});

	it('reports a failed write, since most callers void the promise', async () => {
		const { trainer, control } = await paired();
		control.answer = () => 'fail';
		await expect(trainer.setTargetPower(200)).rejects.toThrow();
		expect(warn).toHaveBeenCalled();
	});

	it('keeps ERG alive after a control-point timeout', async () => {
		const { trainer, control } = await paired();
		control.answer = (f) => (targetWatts(f) === 200 ? 'silent' : 'ack');

		const stalled = trainer.setTargetPower(200);
		const timedOut = expect(stalled).rejects.toThrow('timed out');
		await vi.advanceTimersByTimeAsync(3000);
		await timedOut;

		await trainer.setTargetPower(300);
		expect(targetsWritten(control)).toEqual([200, 300]);
	});

	it('reattaches all the way to connected after a dropout', async () => {
		const { trainer, device, control } = await paired();
		// A write is in flight when the link dies: its rejection used to poison the
		// queue, so the reattach's request-control write could never succeed and
		// the backoff climbed to its 30 s ceiling forever.
		control.answer = (f) => (f[0] === 0x05 ? 'silent' : 'ack');
		const stalled = trainer.setTargetPower(200);
		const dropped = expect(stalled).rejects.toThrow('disconnected');
		await vi.advanceTimersByTimeAsync(0); // let the write reach the device

		device.drop();
		await dropped;
		expect(trainer.status).toBe('connecting');

		await vi.advanceTimersByTimeAsync(1000);
		expect(trainer.status).toBe('connected');
		expect(device.connects).toBe(2);
	});

	it('does not stack characteristic listeners across reattaches', async () => {
		const { trainer, device } = await paired();
		const samples: number[] = [];
		trainer.onSample((s) => samples.push(s.watts));

		device.drop();
		await vi.advanceTimersByTimeAsync(1000);

		// flags 0x0041: no speed, instantaneous power — one frame, one sample.
		device.bikeData.notify(Uint8Array.of(0x41, 0x00, 0xfa, 0x00));
		expect(samples).toEqual([250]);
	});

	it('serializes writes behind the indication of the one before', async () => {
		const { trainer, control } = await paired();
		control.answer = () => 'silent';

		const first = trainer.setTargetPower(200);
		void trainer.setTargetPower(250).catch(() => {});
		await vi.advanceTimersByTimeAsync(0);
		expect(targetsWritten(control)).toEqual([200]);

		control.indicate(0x05);
		await first;
		await vi.advanceTimersByTimeAsync(0);
		expect(targetsWritten(control)).toEqual([200, 250]);
	});
});
