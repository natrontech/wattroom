import { describe, expect, it } from 'vitest';
import { curvePoints, normalizedPower, rideXp, zoneSeconds } from './stats';

const flat = (watts: number, seconds: number) =>
	Array.from({ length: seconds }, () => ({ watts }));

describe('zoneSeconds', () => {
	it('buckets seconds into the SPEC zones and skips zeros', () => {
		const samples = [...flat(100, 10), ...flat(200, 20), ...flat(0, 5)];
		const zones = zoneSeconds(samples, 200); // 50 % = Z1, 100 % = Z4
		expect(zones[1]).toBe(10);
		expect(zones[4]).toBe(20);
		expect(zones.reduce((a, b) => a + b, 0)).toBe(30);
	});
});

describe('curvePoints', () => {
	it('finds the spike and stays honest about short windows', () => {
		const samples = flat(200, 90);
		for (let i = 40; i < 45; i++) samples[i] = { watts: 600 };
		const curve = curvePoints(samples);
		expect(curve[0]).toEqual({ label: '5 s', watts: 600 });
		expect(curve[2].watts).toBe(0); // 5 min window on a 90 s ride
	});
});

describe('normalizedPower', () => {
	it('equals average power on a steady ride', () => {
		expect(normalizedPower(flat(200, 120))).toBe(200);
	});

	it('sits above average on a spiky ride — the point of NP', () => {
		const spiky = [...flat(100, 300), ...flat(400, 300)];
		const avg = 250;
		expect(normalizedPower(spiky)).toBeGreaterThan(avg);
	});
});

describe('rideXp', () => {
	it('is the SPEC formula', () => {
		expect(rideXp(400, 0.9)).toBe(445);
	});
});
