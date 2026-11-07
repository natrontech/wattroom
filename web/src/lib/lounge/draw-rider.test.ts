import { describe, expect, it } from 'vitest';
import { PEDAL_FRAMES, pedalAt } from '$lib/lounge/draw-rider';

const [BBX, BBY] = [-2, 8]; // the bottom bracket, x forward and y up

describe('pedalAt', () => {
	it('turns forward: front, then bottom, then rear, then top', () => {
		const q = PEDAL_FRAMES / 4;
		const [fx] = pedalAt(0, 1);
		const [, by] = pedalAt(q, 1);
		const [rx] = pedalAt(2 * q, 1);
		const [, ty] = pedalAt(3 * q, 1);
		expect(fx).toBeGreaterThan(BBX); // at the front
		expect(by).toBeLessThan(BBY); // a quarter turn on it is at the bottom
		expect(rx).toBeLessThan(BBX); // then at the rear
		expect(ty).toBeGreaterThan(BBY); // then over the top
	});

	it('keeps the two pedals half a turn apart', () => {
		const [rx, ry] = pedalAt(3, 1);
		const [lx, ly] = pedalAt(3, -1);
		expect(rx + lx).toBeCloseTo(2 * BBX);
		expect(ry + ly).toBeCloseTo(2 * BBY);
	});
});
