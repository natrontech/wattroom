import { describe, expect, it } from 'vitest';
import { DEFAULT_AZIMUTH, lightAt, sunAzimuth, sunElevation } from './light';
import {
	DIORAMA_NIGHT,
	DIORAMA_RAIN,
	DIORAMA_RIDE,
	DIORAMA_SNOW,
	RIDE,
} from './look.test-helper';

describe('the ride light (ADR-0072)', () => {
	it('sinks the sun from −4° to −8° by progress, and holds −6° with no known end', () => {
		expect(sunElevation(0)).toBe(-4);
		expect(sunElevation(0.5)).toBe(-6);
		expect(sunElevation(1)).toBe(-8);
		expect(sunElevation(null)).toBe(-6);
		expect(sunElevation(1.4)).toBe(-8);
	});

	it('lights the ride from the sky alone: no key, from straight above', () => {
		const l = lightAt(RIDE, 0);
		expect(l.keyed).toBe(false);
		expect(l.from.toArray()).toEqual([0, 1, 0]);
	});

	it('shows no star at the start, and stars once the zenith has darkened', () => {
		expect(lightAt(RIDE, 0).stars).toBe(0);
		expect(lightAt(RIDE, null).stars).toBe(0);
		expect(lightAt(RIDE, 1).stars).toBeGreaterThan(0.9);
	});

	it('ends visibly darker than it starts, and the peach band fades with it', () => {
		const start = lightAt(RIDE, 0);
		const end = lightAt(RIDE, 1);
		expect(start.dusk).toBe(1);
		expect(end.dusk).toBeLessThan(0.7);
		expect(start.peach).toBe(1);
		expect(end.peach).toBeLessThan(start.peach);
	});

	it('lights the villages a quarter into a ride, at once with no known end, never under a sun that is up', () => {
		expect(lightAt(RIDE, 0.2).lamps).toBe(false);
		expect(lightAt(RIDE, 0.25).lamps).toBe(true);
		expect(lightAt(RIDE, null).lamps).toBe(true);
		const desk = { ...RIDE, sun: { ...RIDE.sun, elevation: 9 } };
		expect(lightAt(desk, 1).lamps).toBe(false);
	});

	it('leaves a look whose sun is up its own sun and key', () => {
		const desk = { ...RIDE, sun: { ...RIDE.sun, elevation: 9 } };
		const l = lightAt(desk, 1);
		expect(l.keyed).toBe(true);
		expect(l.dusk).toBe(1);
		expect(l.from.y).toBeCloseTo(Math.sin((9 * Math.PI) / 180));
	});
});

describe('Diorama’s low sun', () => {
	const deg = (v: { y: number }) => (Math.asin(v.y) * 180) / Math.PI;
	it('sinks from 12° to 3° over a ride with a known end, keyed all the way', () => {
		expect(deg(lightAt(DIORAMA_RIDE, 0).sun)).toBeCloseTo(12, 5);
		expect(deg(lightAt(DIORAMA_RIDE, 1).sun)).toBeCloseTo(3, 5);
		expect(lightAt(DIORAMA_RIDE, 1).keyed).toBe(true);
		expect(lightAt(DIORAMA_RIDE, 1).lamps).toBe(false);
	});

	it('holds 12° with no known end', () => {
		expect(deg(lightAt(DIORAMA_RIDE, null).sun)).toBeCloseTo(12, 5);
	});

	it('rides the whole night under the horizon: lamps lit and stars out from the start to the finish', () => {
		for (const p of [0, 0.5, 1, null]) {
			const l = lightAt(DIORAMA_NIGHT, p);
			expect(l.keyed).toBe(false);
			expect(l.lamps).toBe(true);
			expect(l.stars).toBeGreaterThan(0.5);
		}
	});

	it('hides the sun under rain and snow, and greys the sky without losing its night', () => {
		expect(DIORAMA_RAIN.sun.disc).toBe('none');
		expect(DIORAMA_RAIN.weather).toBe('rain');
		expect(DIORAMA_RAIN.fogK).toBeGreaterThan(DIORAMA_RIDE.fogK * 2);
		expect(DIORAMA_SNOW.weather).toBe('snow');
		expect(lightAt(DIORAMA_SNOW, 0).lamps).toBe(true);
	});
});

describe('the sun’s bearing', () => {
	it('is SunCalc’s at dusk, at the place rounded to 0.1°', () => {
		// 46.96, 7.43 rounds to 47.0, 7.4.
		const place = { lat: 46.96, lon: 7.43 };
		expect(sunAzimuth(place, new Date('2026-06-21T12:00:00Z'))).toBeCloseTo(
			314.54,
			1,
		);
		expect(sunAzimuth(place, new Date('2026-12-21T12:00:00Z'))).toBeCloseTo(
			241.89,
			1,
		);
	});

	it('falls back to the default with no place, or where the sun never sinks to −6°', () => {
		expect(sunAzimuth(null, new Date())).toBe(DEFAULT_AZIMUTH);
		expect(
			sunAzimuth({ lat: 78.2, lon: 15.6 }, new Date('2026-06-21T12:00:00Z')),
		).toBe(DEFAULT_AZIMUTH);
	});
});
