import { describe, expect, it } from 'vitest';
import { HUD_STALE_MS, isStale } from './feed';

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
