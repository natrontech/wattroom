import { describe, expect, it } from 'vitest';
import {
	curvePoints,
	normalizedPower,
	powerTrace,
	rideXp,
	zoneSeconds,
} from './stats';

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
		const spiky = [...flat(100, 900), ...flat(400, 900)];
		const avg = 250;
		expect(normalizedPower(spiky)).toBeGreaterThan(avg);
	});

	it('is the plain average under 20 minutes, as the server stores it (#1542)', () => {
		const spiky = [...flat(100, 300), ...flat(400, 300)];
		expect(normalizedPower(spiky)).toBe(250);
		expect(normalizedPower(flat(200, 20 * 60 - 1))).toBe(200);
	});
});

describe('rideXp', () => {
	it('is the SPEC formula', () => {
		expect(rideXp(400, 0.9)).toBe(445);
	});
});

describe('powerTrace (#1559)', () => {
	it('draws nothing for one sample and a bounded path for a long ride', () => {
		expect(powerTrace(flat(200, 1), 250, 600, 120)).toBeNull();
		const long = powerTrace(flat(200, 7200), 250, 600, 120)!;
		expect(long.path.split(' L ').length).toBeLessThanOrEqual(300);
		expect(long.path.startsWith('M 0.0 ')).toBe(true);
	});

	it('hands back columns that tile the box from the same buckets', () => {
		const spiky = [...flat(100, 600), ...flat(400, 600)];
		const t = powerTrace(spiky, 250, 600, 120)!;
		// Edge to edge, and touching: a gap draws a stripe of background
		// through the trace and an overhang spills out of the panel.
		expect(t.columns[0].x).toBe(0);
		const last = t.columns.at(-1)!;
		expect(last.x + last.width).toBeCloseTo(600, 5);
		for (let i = 1; i < t.columns.length; i++) {
			expect(t.columns[i].x).toBeCloseTo(
				t.columns[i - 1].x + t.columns[i - 1].width,
				5,
			);
		}
		// Same buckets as the path, so the colour and the line cannot disagree
		// about the same second.
		expect(t.columns.length).toBe(t.path.split(/M |L /).length - 1);
		expect(t.columns[0].watts).toBe(100);
		expect(last.watts).toBe(400);
	});

	it('keeps the FTP line inside the box and the peak at the top', () => {
		const spiky = [...flat(100, 60), ...flat(400, 60)];
		const t = powerTrace(spiky, 250, 600, 120)!;
		expect(t.top).toBe(400);
		expect(t.ftpY).toBeCloseTo(120 - (250 / 400) * 120, 5);
		// A ride that never reaches FTP still leaves 20 % headroom above it.
		expect(powerTrace(flat(100, 120), 250, 600, 120)!.top).toBe(300);
	});
});
