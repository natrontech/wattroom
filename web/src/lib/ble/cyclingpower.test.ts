import { describe, expect, it } from 'vitest';
import { parseCyclingPower } from './cyclingpower';

const packet = (...bytes: number[]) =>
	new DataView(Uint8Array.of(...bytes).buffer);
const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [
	v & 0xff,
	(v >> 8) & 0xff,
	(v >> 16) & 0xff,
	(v >>> 24) & 0xff,
];

describe('parseCyclingPower', () => {
	it('reads instantaneous power from a minimal packet', () => {
		expect(parseCyclingPower(packet(...u16(0), ...u16(250)))).toEqual({
			watts: 250,
		});
	});

	it('reads power as signed — a reverse stroke is negative', () => {
		const view = packet(...u16(0), 0xf6, 0xff); // -10
		expect(parseCyclingPower(view).watts).toBe(-10);
	});

	it('finds crank data behind the fields it does not want', () => {
		// balance (bit0, 1 byte) + torque (bit2, 2 bytes) + wheel (bit4, 6 bytes)
		// + crank (bit5). Miscount any of those and the crank reads as garbage.
		const flags = 0x0001 | 0x0004 | 0x0010 | 0x0020;
		const view = packet(
			...u16(flags),
			...u16(300),
			50, // pedal power balance
			...u16(1234), // accumulated torque
			...u32(9999), // cumulative wheel revolutions
			...u16(4096), // last wheel event time
			...u16(600), // cumulative crank revolutions
			...u16(2048), // last crank event time
		);
		expect(parseCyclingPower(view)).toEqual({
			watts: 300,
			crank: { revs: 600, eventTime: 2048 },
		});
	});

	it('reads crank data when it is the only optional field', () => {
		const view = packet(...u16(0x0020), ...u16(200), ...u16(10), ...u16(1024));
		expect(parseCyclingPower(view).crank).toEqual({
			revs: 10,
			eventTime: 1024,
		});
	});

	it('omits crank data when the meter reports none', () => {
		// Wheel data present, crank absent — a hub-based meter.
		const view = packet(...u16(0x0010), ...u16(180), ...u32(5), ...u16(2048));
		expect(parseCyclingPower(view).crank).toBeUndefined();
	});
});
