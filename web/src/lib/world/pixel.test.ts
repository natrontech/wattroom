import { describe, expect, it } from 'vitest';
import { pixelScale } from './pixel';

describe('pixelScale', () => {
	it('keeps a phone, a laptop and a TV at about 400 whole pixels along the longer side', () => {
		for (const [w, h] of [
			[375, 812],
			[812, 375],
			[1280, 800],
			[1440, 900],
			[1920, 1080],
			[2560, 1440],
			[3840, 2160],
		]) {
			const s = pixelScale(w, h);
			expect(Number.isInteger(s)).toBe(true);
			expect(Math.max(w, h) / s).toBeGreaterThanOrEqual(320);
			expect(Math.max(w, h) / s).toBeLessThanOrEqual(480);
		}
	});
	it('draws a phone held upright at 2, as the lounge does', () => {
		expect(pixelScale(375, 812)).toBe(2);
	});
	it('never goes under one CSS pixel', () => {
		expect(pixelScale(300, 200)).toBe(1);
		expect(pixelScale(0, 0)).toBe(1);
	});
});
