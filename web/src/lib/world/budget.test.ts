import { describe, expect, it } from 'vitest';
import { pace, PIXEL_BUDGET, pixelRatio } from './budget';

/** Which of `frames` animation frames at `hz` render, as a 1/0 string. */
function pattern(hz: number, frames: number, jitter = 0): string {
	let banked = 0;
	let out = '';
	for (let i = 0; i < frames; i++) {
		const wobble = jitter * (i % 2 ? 1 : -1);
		const r = pace(banked, 1 / hz + wobble);
		banked = r.banked;
		out += r.render ? '1' : '0';
	}
	return out;
}

describe('frame pacing', () => {
	it('renders every second frame at 60 Hz, evenly', () => {
		expect(pattern(60, 12)).toBe('010101010101');
	});

	it('stays even through vsync jitter', () => {
		expect(pattern(60, 12, 0.0015)).toBe('010101010101');
	});

	it('renders every fourth frame at 120 Hz', () => {
		expect(pattern(120, 12)).toBe('000100010001');
	});

	it('averages 30 fps at 144 Hz without drifting', () => {
		const rendered = [...pattern(144, 1440)].filter((c) => c === '1').length;
		expect(rendered).toBeGreaterThanOrEqual(295);
		expect(rendered).toBeLessThanOrEqual(305);
	});

	it('renders every frame on a 30 Hz display', () => {
		expect(pattern(30, 6)).toBe('111111');
	});
});

describe('the pixel budget', () => {
	it('keeps the device ratio on a small view', () => {
		expect(pixelRatio(800, 600, 2)).toBeCloseTo(
			Math.sqrt(PIXEL_BUDGET / 480_000),
		);
		expect(pixelRatio(375, 400, 2)).toBe(2);
	});

	it('draws a big window below one pixel per CSS pixel', () => {
		const r = pixelRatio(2560, 1440, 2);
		expect(r).toBeLessThan(1);
		expect(2560 * 1440 * r * r).toBeCloseTo(PIXEL_BUDGET, -3);
	});

	it('never drops below half resolution', () => {
		expect(pixelRatio(8000, 8000, 2)).toBe(0.5);
	});
});
