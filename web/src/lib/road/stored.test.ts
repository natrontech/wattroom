import { describe, expect, it } from 'vitest';
import { encodePolyline6, packRoad, type Road } from './road';
import { roadOf, shapeLine, type StoredRoute } from './stored';

const base64 = (bytes: Uint8Array) =>
	btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));

const stored = (road?: Road): StoredRoute => ({
	id: 'r1',
	name: 'Road · 3.0 km · 50 m',
	generatedName: 'Road · 3.0 km · 50 m',
	src: 'gpx',
	lengthM: 3000,
	gainM: 50,
	climbs: [],
	hasPlace: true,
	ownerOnly: false,
	createdAt: '2026-09-30T00:00:00Z',
	road: road && base64(packRoad(road)),
});

describe('a stored route read back (#3061)', () => {
	it('unpacks the road a route read carries', () => {
		const road: Road = {
			length: 60,
			heights: [500, 502.5, 501],
			turns: [3, -7],
		};
		expect(roadOf(stored(road))).toEqual(road);
		expect(roadOf(stored())).toBeNull();
	});

	// Invented, in the open South Atlantic (#3054): a kilometre east, then
	// half a kilometre south.
	it('draws the owner’s map as metres east and south', () => {
		const perLon = 111_195 * Math.cos((30 * Math.PI) / 180);
		const shape = encodePolyline6([
			{ lat: -30, lon: -25 },
			{ lat: -30, lon: -25 + 1000 / perLon },
			{ lat: -30 - 500 / 111_195, lon: -25 + 1000 / perLon },
		]);
		const { x, z } = shapeLine(shape);
		expect(x[1] - x[0]).toBeCloseTo(1000, -1);
		expect(z[2] - z[1]).toBeCloseTo(500, -1);
		expect(z[1] - z[0]).toBeCloseTo(0, 0);
	});
});
