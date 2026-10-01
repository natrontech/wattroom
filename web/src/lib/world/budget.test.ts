import { describe, expect, it } from 'vitest';
import { PIXEL_BUDGET, pixelRatio } from './budget';

describe('the pixel budget', () => {
	it('keeps the device ratio on a small view', () => {
		expect(pixelRatio(375, 400, 2)).toBe(2);
	});

	it('draws about one megapixel on anything bigger', () => {
		for (const [w, h] of [
			[800, 600],
			[2560, 1440],
			[8000, 8000],
		]) {
			const r = pixelRatio(w, h, 2);
			expect(w * h * r * r).toBeCloseTo(PIXEL_BUDGET, -3);
		}
	});

	it('has no floor: a huge window drops well below half resolution', () => {
		expect(pixelRatio(8000, 8000, 2)).toBeCloseTo(0.125);
	});
});
