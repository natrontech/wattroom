import { describe, expect, it } from 'vitest';
import { readFit } from './fit';
import { MAX_ROUTE_FILE_BYTES, parseRoute, RouteError } from './parse';

// A synthetic FIT file, built here (#3058): no fixture is anyone's ride. Each
// field is [number, size, value]; a message is its definition and one data
// row. The trailing CRC is written as zero — fit.ts does not read it.
type Field = [num: number, size: 1 | 2 | 4, value: number];
type Message = {
	global: number;
	fields: Field[];
	local?: number;
	big?: boolean;
	dev?: number[];
	compressed?: boolean;
};

function fitFile(messages: Message[], cut = 0): Uint8Array {
	const body: number[] = [];
	const put = (v: number, size: number, big: boolean) => {
		const b = new DataView(new ArrayBuffer(4));
		if (size === 1) b.setUint8(0, v);
		else if (size === 2) b.setUint16(0, v, !big);
		else b.setUint32(0, v >>> 0, !big);
		body.push(...new Uint8Array(b.buffer, 0, size));
	};
	for (const m of messages) {
		const local = m.local ?? 0;
		const dev = m.dev ?? [];
		body.push(0x40 | (dev.length ? 0x20 : 0) | local, 0, m.big ? 1 : 0);
		put(m.global, 2, !!m.big);
		body.push(m.fields.length);
		for (const [num, size] of m.fields) body.push(num, size, 0);
		if (dev.length) {
			body.push(dev.length);
			for (const size of dev) body.push(0, size, 0);
		}
		body.push(m.compressed ? 0x80 | (local << 5) | 7 : local);
		for (const [, size, value] of m.fields) put(value, size, !!m.big);
		for (const size of dev) for (let i = 0; i < size; i++) body.push(0xaa);
	}
	const data = body.slice(0, body.length - cut);
	const header = [
		14, 0x20, 0x54, 0x08, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0,
	];
	new DataView(new Uint8Array(header).buffer).setUint32(4, body.length, true);
	const out = new Uint8Array(14 + data.length + 2);
	out.set(header);
	new DataView(out.buffer).setUint32(4, body.length, true);
	out.set(data, 14);
	return out;
}

const deg = (d: number) => Math.round(d * (2 ** 31 / 180));
const fileId = (manufacturer: number): Message => ({
	global: 0,
	fields: [
		[0, 1, 6], // type: course
		[1, 2, manufacturer],
	],
});
const record = (
	lat: number,
	lon: number,
	alt: number,
	extra: Partial<Message> = {},
): Message => ({
	global: 20,
	fields: [
		[0, 4, deg(lat)],
		[1, 4, deg(lon)],
		[2, 2, (alt + 500) * 5],
	],
	...extra,
});
const GARMIN = 1;
const STRAVA = 265;

describe('a FIT course becomes points (#3058)', () => {
	it('reads each record’s position and altitude', () => {
		const read = readFit(
			fitFile([
				fileId(GARMIN),
				record(-30, -25, 100),
				record(-30, -24.999, 104.2),
			]),
		);
		expect('refused' in read).toBe(false);
		if ('refused' in read) return;
		expect(read.strava).toBe(false);
		expect(read.points).toHaveLength(2);
		expect(read.points[0].lat).toBeCloseTo(-30, 6);
		expect(read.points[1].lon).toBeCloseTo(-24.999, 6);
		expect(read.points[1].ele).toBeCloseTo(104.2, 6);
	});

	it('takes enhanced_altitude over altitude', () => {
		const high: Message = {
			global: 20,
			fields: [
				[0, 4, deg(-30)],
				[1, 4, deg(-25)],
				[2, 2, (100 + 500) * 5],
				[78, 4, (2500 + 500) * 5],
			],
		};
		const read = readFit(fitFile([high, record(-30, -24.99, 90)]));
		if ('refused' in read) throw new Error(read.refused);
		expect(read.points[0].ele).toBeCloseTo(2500, 6);
	});

	it('reads big-endian messages, compressed headers and steps over developer data', () => {
		const read = readFit(
			fitFile([
				record(-30, -25, 10, { big: true }),
				record(-30, -24.99, 11, { local: 1, compressed: true }),
				record(-30, -24.98, 12, { local: 2, dev: [3, 2] }),
			]),
		);
		if ('refused' in read) throw new Error(read.refused);
		expect(read.points.map((p) => Math.round(p.ele))).toEqual([10, 11, 12]);
	});

	it('marks a Strava export, which rides owner-only', () => {
		const read = readFit(
			fitFile([fileId(STRAVA), record(-30, -25, 1), record(-30, -24.99, 2)]),
		);
		if ('refused' in read) throw new Error(read.refused);
		expect(read.strava).toBe(true);
		expect(
			parseRoute(
				fitFile([fileId(STRAVA), record(-30, -25, 1), record(-30, -24.99, 2)]),
			).src,
		).toBe('stravagpx');
		expect(
			parseRoute(
				fitFile([fileId(GARMIN), record(-30, -25, 1), record(-30, -24.99, 2)]),
			).src,
		).toBe('fit');
	});

	it('skips records with no position, and refuses a file that has none', () => {
		const noPlace: Message = {
			global: 20,
			fields: [
				[0, 4, 0x7fffffff],
				[1, 4, 0x7fffffff],
				[2, 2, 3000],
			],
		};
		const some = readFit(fitFile([noPlace, record(-30, -25, 1), noPlace]));
		if ('refused' in some) throw new Error(some.refused);
		expect(some.points).toHaveLength(1);
		const none = readFit(fitFile([fileId(GARMIN), noPlace, noPlace]));
		expect(none).toEqual({ refused: expect.stringMatching(/no positions/) });
	});

	it('refuses what it cannot read, saying why', () => {
		expect(
			readFit(new TextEncoder().encode('<gpx>not a fit file</gpx>')),
		).toEqual({
			refused: expect.stringMatching(/not a FIT course/),
		});
		expect(
			readFit(fitFile([record(-30, -25, 1), record(-30, -24.99, 2)], 3)),
		).toEqual({
			refused: expect.stringMatching(/ends in the middle of a message/),
		});
	});

	it('refuses a file over the route ceiling before reading it', () => {
		const big = new Uint8Array(MAX_ROUTE_FILE_BYTES + 1);
		big.set(fitFile([record(-30, -25, 1)]));
		expect(() => parseRoute(big)).toThrow(RouteError);
		expect(() => parseRoute(big)).toThrow(/over 5 MB/);
	});
});
