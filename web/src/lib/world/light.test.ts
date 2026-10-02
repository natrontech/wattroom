import { describe, expect, it } from 'vitest';
import { DEFAULT_AZIMUTH, lightAt, sunAzimuth, sunElevation } from './light';
import { RIDE } from './look.test-helper';

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

	it('leaves a look whose sun is up its own sun and key', () => {
		const desk = { ...RIDE, sun: { ...RIDE.sun, elevation: 9 } };
		const l = lightAt(desk, 1);
		expect(l.keyed).toBe(true);
		expect(l.dusk).toBe(1);
		expect(l.from.y).toBeCloseTo(Math.sin((9 * Math.PI) / 180));
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
