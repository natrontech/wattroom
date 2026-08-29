import { describe, expect, it } from 'vitest';
import { parseHeartRate } from './heartrate';

const packet = (...bytes: number[]) =>
	new DataView(Uint8Array.of(...bytes).buffer);
/** Little-endian uint16 as a byte pair. */
const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];

describe('parseHeartRate', () => {
	it('reads a uint8 rate, the common case', () => {
		expect(parseHeartRate(packet(0x00, 142))).toEqual({ heartRate: 142 });
	});

	it('reads a uint16 rate when the format bit says so', () => {
		expect(parseHeartRate(packet(0x01, ...u16(142)))).toEqual({
			heartRate: 142,
		});
	});

	it('ignores contact bits rather than mistaking them for a wider field', () => {
		// Contact detected + supported set; the rate is still a uint8.
		expect(parseHeartRate(packet(0x06, 130))).toEqual({ heartRate: 130 });
	});

	it('skips energy expended before reading RR intervals', () => {
		// Energy (bit 3) and RR (bit 4). Reading RR without skipping energy would
		// return the energy value as a beat interval.
		const view = packet(0x18, 150, ...u16(900), ...u16(1024));
		expect(parseHeartRate(view)).toEqual({
			heartRate: 150,
			rrIntervals: [1000],
		});
	});

	it('reads every RR interval in the packet, not just the first', () => {
		// The §11 trap: a variable count fills the remainder.
		const view = packet(0x10, 160, ...u16(1024), ...u16(512), ...u16(256));
		expect(parseHeartRate(view)).toEqual({
			heartRate: 160,
			rrIntervals: [1000, 500, 250],
		});
	});

	it('omits RR entirely when the strap does not send it', () => {
		expect(parseHeartRate(packet(0x00, 120)).rrIntervals).toBeUndefined();
	});

	it('does not invent an RR interval from a truncated trailing byte', () => {
		const view = packet(0x10, 160, ...u16(1024), 0x07);
		expect(parseHeartRate(view).rrIntervals).toEqual([1000]);
	});
});

/**
 * Real packets from a Polar H10, captured over Web Bluetooth (2026-08-29). Pinned
 * because §11's variable-count RR warning is not hypothetical: six of the fifty-five
 * packets in that session carried *two* intervals, and a parser reading only the
 * first would have dropped those beats while still displaying a correct bpm — the
 * failure would never have shown on screen.
 *
 * The strap alternates: flags 0x10 when a beat fell in the notification window,
 * 0x00 when none did.
 */
describe('Polar H10, captured', () => {
	const captured: Array<
		[string, { heartRate: number; rrIntervals?: number[] }]
	> = [
		['00 3f', { heartRate: 63 }],
		['10 3f 69 04', { heartRate: 63, rrIntervals: [1103] }],
		['10 3e 5a 04', { heartRate: 62, rrIntervals: [1088] }],
		// Two intervals in one packet — the case that matters.
		['10 3e 8d 03 be 03', { heartRate: 62, rrIntervals: [888, 936] }],
		['10 3d 37 04 23 04', { heartRate: 61, rrIntervals: [1054, 1034] }],
	];

	it.each(captured)('parses %s', (hex, expected) => {
		const bytes = hex.split(' ').map((b) => parseInt(b, 16));
		expect(parseHeartRate(packet(...bytes))).toEqual(expected);
	});
});
