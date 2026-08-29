import { describe, expect, it } from 'vitest';
import { parseCsc } from './cadence';

const packet = (...bytes: number[]) =>
	new DataView(Uint8Array.of(...bytes).buffer);
const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [
	v & 0xff,
	(v >> 8) & 0xff,
	(v >> 16) & 0xff,
	(v >>> 24) & 0xff,
];

describe('parseCsc', () => {
	it('reads crank data from a cadence-only sensor', () => {
		const view = packet(0x02, ...u16(120), ...u16(3072));
		expect(parseCsc(view).crank).toEqual({ revs: 120, eventTime: 3072 });
	});

	it('steps over the wheel block to find the crank block', () => {
		const view = packet(
			0x03,
			...u32(4000), // cumulative wheel revolutions
			...u16(1024), // last wheel event time
			...u16(120),
			...u16(3072),
		);
		expect(parseCsc(view).crank).toEqual({ revs: 120, eventTime: 3072 });
	});

	it('reports nothing for a wheel-only sensor', () => {
		const view = packet(0x01, ...u32(4000), ...u16(1024));
		expect(parseCsc(view).crank).toBeUndefined();
	});
});
