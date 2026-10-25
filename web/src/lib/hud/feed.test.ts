import { describe, expect, it } from 'vitest';
import {
	createZoneClock,
	HUD_STALE_MS,
	isSnapshot,
	isStale,
	withZones,
} from './feed';

describe('the HUD goes quiet when the ride does', () => {
	it('is stale with nothing heard, or two missed ticks ago', () => {
		const now = 1_000_000;
		expect(isStale(null, now)).toBe(true);
		const fresh = {
			at: now - 900,
			watts: 1,
			target: 1,
			remaining: 1,
			label: '',
		};
		expect(isStale(fresh, now)).toBe(false);
		expect(isStale({ ...fresh, at: now - HUD_STALE_MS - 1 }, now)).toBe(true);
	});
});

describe('an older HUD window reads a newer feed (#3060)', () => {
	const base = { at: 1, watts: 200, target: 210, remaining: 60, label: 'x' };

	it('takes a snapshot carrying the road, and a key it has never heard of', () => {
		const newer = {
			...base,
			road: { grade: 7.6, km: 12.4, totalKm: 52.9, toTopM: 3200 },
			fromTheFuture: { anything: true },
		};
		expect(isSnapshot(newer)).toBe(true);
	});

	it('still refuses one missing a field every snapshot carries', () => {
		const { watts: _gone, ...broken } = base;
		expect(isSnapshot(broken)).toBe(false);
		expect(isSnapshot(null)).toBe(false);
	});
});

describe('the zone and its time (#4099)', () => {
	const ride = { watts: 250, target: 0, remaining: 0, label: 'Free ride' };
	const rider = { ftpWatts: 250, lthr: 170 };

	it('restarts the time in zone when the zone changes', () => {
		const clock = createZoneClock();
		const at = (s: number, watts: number) =>
			withZones({ ...ride, watts }, 1_000_000 + s * 1000, rider, clock);
		expect(at(0, 250)).toMatchObject({ zone: 4, zoneSeconds: 0 });
		// A channel publishes more than once a second; time, not calls.
		at(0.5, 250);
		for (let s = 1; s < 90; s++) at(s, 250);
		expect(at(90, 250)).toMatchObject({ zone: 4, zoneSeconds: 90 });
		expect(at(91, 320)).toMatchObject({ zone: 6, zoneSeconds: 0 });
		for (let s = 92; s < 95; s++) at(s, 320);
		expect(at(95, 320).zoneSeconds).toBe(4);
		// Coasting is no zone and no time; pedalling again starts over.
		const coast = at(96, 0);
		expect(coast.zone).toBe(0);
		expect(coast).not.toHaveProperty('zoneSeconds');
		expect(at(97, 320)).toMatchObject({ zone: 6, zoneSeconds: 0 });
		// A ride resumed after the HUD went quiet is a new stint.
		expect(at(97 + HUD_STALE_MS / 1000 + 1, 320).zoneSeconds).toBe(0);
	});

	it('carries the heart zone only with an LTHR and a heart rate', () => {
		const clock = createZoneClock();
		expect(
			withZones({ ...ride, heartRate: 155 }, 1, rider, clock).heartZone,
		).toBe(3);
		expect(withZones(ride, 2, rider, clock)).not.toHaveProperty('heartZone');
		expect(
			withZones({ ...ride, heartRate: 160 }, 3, { ftpWatts: 250 }, clock),
		).not.toHaveProperty('heartZone');
	});

	it('round-trips the new fields, and draws a snapshot without them', () => {
		const full = withZones(
			{ ...ride, heartRate: 150, cadence: 90 },
			5,
			rider,
			createZoneClock(),
		);
		const wire = structuredClone(full);
		expect(isSnapshot(wire)).toBe(true);
		expect(wire).toEqual(full);
		expect(isSnapshot(withZones(ride, 5, null))).toBe(true);
		expect(withZones(ride, 5, null)).not.toHaveProperty('zone');
	});
});
