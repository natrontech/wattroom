import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	FtmsTrainer,
	parseIndoorBikeData,
	clampTarget,
	DEFAULT_POWER_RANGE,
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
 * The write queue (#518). The class had no test at all, which is how a
 * rejected queue tail survived: `.then` on a rejected promise skips its
 * callback and stays rejected, so one control-point timeout silently ended
 * ERG for the session and left the reattach unable to re-request control.
 */
class FakeChar extends EventTarget {
	value?: DataView;
	writes: Uint8Array[] = [];
	ack = true;
	constructor(private readonly bytes?: number[]) {
		super();
	}
	async startNotifications() {
		return this;
	}
	async readValue() {
		return new DataView(Uint8Array.from(this.bytes ?? []).buffer);
	}
	async writeValueWithResponse(buffer: ArrayBuffer) {
		const bytes = new Uint8Array(buffer);
		this.writes.push(bytes);
		if (!this.ack) return;
		// 0x80 <op> <result>: the indication every write waits on.
		this.value = new DataView(Uint8Array.of(0x80, bytes[0], 0x01).buffer);
		this.dispatchEvent(new Event('characteristicvaluechanged'));
	}
}

function fakeTrainer() {
	const control = new FakeChar();
	const chars: Record<number, FakeChar> = {
		0x2ad2: new FakeChar(),
		0x2ad9: control,
		0x2ad8: new FakeChar([0x00, 0x00, 0xd0, 0x07, 0x01, 0x00]),
		0x2ada: new FakeChar(),
	};
	const device = {
		name: 'Fake Core',
		addEventListener() {},
		gatt: {
			connect: async () => ({
				getPrimaryService: async () => ({
					getCharacteristic: async (id: number) => {
						const char = chars[id];
						if (!char) throw new Error('no such characteristic');
						return char;
					},
				}),
			}),
		},
	};
	vi.stubGlobal('navigator', {
		bluetooth: { requestDevice: async () => device },
	});
	return control;
}

describe('FtmsTrainer control-point queue', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('keeps writing after one write times out', async () => {
		vi.useFakeTimers();
		const control = fakeTrainer();
		const trainer = new FtmsTrainer();
		await trainer.connect();
		expect(control.writes).toHaveLength(1); // the control grant

		// The expectation is attached before the clock moves, or the rejection
		// is briefly unhandled and node warns about it.
		control.ack = false;
		const stalled = expect(trainer.setTargetPower(200)).rejects.toThrow(
			/timed out/,
		);
		await vi.advanceTimersByTimeAsync(3000);
		await stalled;

		// The whole point: the queue is still usable.
		control.ack = true;
		await trainer.setTargetPower(250);
		await trainer.setSimulation(3);
		expect(control.writes).toHaveLength(4);
		expect(control.writes[2][0]).toBe(0x05); // set target power
		expect(control.writes[3][0]).toBe(0x11); // set simulation
	});
});
