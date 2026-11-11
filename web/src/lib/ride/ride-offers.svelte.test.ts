import { describe, expect, it, vi } from 'vitest';
import { createRideOffers } from './ride-offers.svelte';

describe('what the riding screen offers the phone', () => {
	it('runs the latest offer, and the one under it once that goes', () => {
		const offers = createRideOffers();
		const open = vi.fn();
		const exit = vi.fn();
		const offOpen = offers.offer('tv', open);
		const offExit = offers.offer('tv', exit);
		expect(offers.run('tv')).toBe(true);
		expect(exit).toHaveBeenCalledOnce();
		expect(open).not.toHaveBeenCalled();
		offExit();
		offers.run('tv');
		expect(open).toHaveBeenCalledOnce();
		offOpen();
		expect(offers.run('tv')).toBe(false);
	});

	it('keeps TV mode’s way out over a button that offers again under it', () => {
		const offers = createRideOffers();
		const exit = vi.fn();
		const open = vi.fn();
		const offExit = offers.offer('tv', exit, true);
		const offOpen = offers.offer('tv', open);
		offers.run('tv');
		expect(exit).toHaveBeenCalledOnce();
		expect(open).not.toHaveBeenCalled();
		offExit();
		offers.run('tv');
		expect(open).toHaveBeenCalledOnce();
		offOpen();
	});

	it('lists each offered action once, in one order whoever offered first', () => {
		const offers = createRideOffers();
		const offs = [
			offers.offer('end', () => {}),
			offers.offer('view-flat', () => {}),
			offers.offer('tv', () => {}),
			offers.offer('tv', () => {}),
		];
		expect(offers.list).toEqual(['view-flat', 'tv', 'end']);
		offs.forEach((off) => off());
		expect(offers.list).toEqual([]);
	});

	it('runs nothing it was not offered', () => {
		const offers = createRideOffers();
		expect(offers.run('flag')).toBe(false);
		expect(offers.run('reboot')).toBe(false);
	});
});
