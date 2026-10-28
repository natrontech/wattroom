import { describe, expect, it } from 'vitest';
import { LIGHT_PIXEL_BUDGET, PIXEL_BUDGET, pixelRatio } from './budget';

describe('the pixel budget', () => {
	it('keeps the device ratio on a small view', () => {
		expect(pixelRatio(375, 400, 2)).toBe(2);
	});

	it('draws about one megapixel where that is at least a pixel per CSS pixel', () => {
		for (const [w, h] of [
			[800, 600],
			[1000, 700],
		]) {
			const r = pixelRatio(w, h, 2);
			expect(r).toBeGreaterThan(1);
			expect(w * h * r * r).toBeCloseTo(PIXEL_BUDGET, -3);
		}
	});

	// #4256: a full desk window, 1850 × 730 CSS px, drew at 0.86 and was scaled up.
	it('never draws under one pixel per CSS pixel', () => {
		for (const [w, h] of [
			[1850, 730],
			[2560, 1440],
			[8000, 8000],
		]) {
			expect(pixelRatio(w, h, 2)).toBe(1);
			expect(pixelRatio(w, h, 1)).toBe(1);
			expect(pixelRatio(w, h, 2, LIGHT_PIXEL_BUDGET)).toBe(1);
		}
	});

	it('never draws more pixels than the device has', () => {
		expect(pixelRatio(3000, 2000, 0.8)).toBe(0.8);
	});
});
