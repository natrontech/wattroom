import { describe, expect, it } from 'vitest';
import { HUD_STALE_MS, isSnapshot, isStale } from './feed';

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
