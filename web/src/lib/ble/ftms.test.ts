import { describe, expect, it } from 'vitest';
import { parseIndoorBikeData } from './ftms';

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
