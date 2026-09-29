import { describe, expect, it } from 'vitest';
import {
	decodePolyline6,
	encodePolyline6,
	packRoad,
	roadHash,
	unpackRoad,
	type Road,
} from './road';

const ROAD: Road = {
	length: 60.04,
	heights: [1712.35, 1716.35, 1712.35, 1712.36],
	turns: [127, -127, 0],
};

describe('packRoad', () => {
	it('comes back as the road it packed, to the centimetre', () => {
		expect(unpackRoad(packRoad(ROAD))).toEqual(ROAD);
	});

	it('takes three bytes a sample after a 13-byte header', () => {
		expect(packRoad(ROAD).byteLength).toBe(13 + 3 * 3);
	});

	it('hashes to 64 hex characters, and differently for a centimetre', async () => {
		const hash = await roadHash(ROAD);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(await roadHash(ROAD)).toBe(hash);
		const lower = { ...ROAD, heights: [1712.34, ...ROAD.heights.slice(1)] };
		expect(await roadHash(lower)).not.toBe(hash);
	});
});

describe('polyline6', () => {
	// Google's worked example, a tenth of the way to scale: polyline6 of a
	// degree is polyline5 of ten.
	const points = [
		{ lat: 3.85, lon: -12.02 },
		{ lat: 4.07, lon: -12.095 },
		{ lat: 4.3252, lon: -12.6453 },
	];
	const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

	it('encodes the reference polyline', () => {
		expect(encodePolyline6(points)).toBe(encoded);
	});

	it('decodes it back', () => {
		expect(decodePolyline6(encoded)).toEqual(points);
	});
});
