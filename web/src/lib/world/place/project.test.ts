import { describe, expect, it } from 'vitest';
import { CHUNK_M, cellOf, cellsOf, chunkOf, COARSE_M, FINE_M } from './lattice';
import { frameAt, localOf, lv95, originOf, utm } from './project';

const dms = (d: number, m: number, s: number) => d + m / 60 + s / 3600;

describe('place frames', () => {
	it('puts Switzerland in LV95, and elsewhere the point’s own UTM zone', () => {
		expect(frameAt(46.95, 7.44)).toEqual({ system: 'LV95' });
		expect(frameAt(48.86, 2.29)).toEqual({
			system: 'UTM',
			zone: 31,
			south: false,
		});
		expect(frameAt(-33.87, 151.21)).toEqual({
			system: 'UTM',
			zone: 56,
			south: true,
		});
	});

	it('projects to LV95 as swisstopo’s worked example does', () => {
		const [e, n] = lv95(dms(46, 2, 38.87), dms(8, 43, 49.79));
		expect(e).toBeCloseTo(2699999.76, 1);
		expect(n).toBeCloseTo(1099999.97, 1);
	});

	it('projects to UTM from the false origin, symmetric about the zone’s meridian', () => {
		const [e0, n0] = utm(0, 3, 31, false);
		expect(e0).toBeCloseTo(500000, 6);
		expect(n0).toBeCloseTo(0, 6);
		const east = utm(45, 4, 31, false);
		const west = utm(45, 2, 31, false);
		expect(east[0] + west[0]).toBeCloseTo(1000000, 6);
		expect(east[1]).toBeCloseTo(west[1], 6);
		// On the meridian, northing is the WGS84 meridian arc (4,984,944.4 m to 45°) at UTM's scale.
		expect(utm(45, 3, 31, false)[1]).toBeCloseTo(0.9996 * 4984944.4, 0);
		// South of the equator the false northing is 10,000 km.
		expect(utm(-1e-9, 3, 31, true)[1]).toBeCloseTo(10000000, 3);
	});

	it('draws around a chunk corner, in float32', () => {
		const origin = originOf(2600123.4, 1200456.7);
		expect(origin).toEqual([2600000, 1200320]);
		const [x, z] = localOf(2600123.4, 1200456.7, origin);
		expect(x).toBe(Math.fround(123.4));
		expect(z).toBe(Math.fround(-136.7));
	});
});

describe('the world lattice', () => {
	it('floors positions, below zero too', () => {
		expect(cellOf(9.999, 0, FINE_M)).toEqual({ size: FINE_M, i: 0, j: 0 });
		expect(cellOf(10, -0.001, FINE_M)).toEqual({ size: FINE_M, i: 1, j: -1 });
		expect(cellOf(-40.01, 39.99, COARSE_M)).toEqual({
			size: COARSE_M,
			i: -2,
			j: 0,
		});
	});

	it('holds each chunk’s cells inside it, aligned', () => {
		const chunk = chunkOf(-170, 330);
		expect(chunk).toEqual({ size: CHUNK_M, i: -2, j: 2 });
		const fine = cellsOf(chunk, FINE_M);
		expect(fine).toHaveLength(256);
		expect(cellsOf(chunk, COARSE_M)).toHaveLength(16);
		for (const c of fine) {
			const back = chunkOf(c.i * FINE_M + 5, c.j * FINE_M + 5);
			expect(back).toEqual(chunk);
		}
	});
});
