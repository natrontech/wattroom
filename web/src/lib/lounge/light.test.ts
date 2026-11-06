import { describe, expect, it } from 'vitest';
import { BANDS, DARKNESS, stepAt, type Light } from '$lib/lounge/light';

const room = { w: 320, h: 180, floorRow: 80 };
const lamp: Light = { x: 90, y: 40, rx: 60, ry: 40, power: 1, on: 'wall' };

/** The mean step over a 4 × 4 tile, which is what the dither averages out to. */
function mean(x: number, y: number, lights: Light[]) {
	let sum = 0;
	for (let j = 0; j < 4; j++)
		for (let i = 0; i < 4; i++)
			sum += stepAt(x + i, y + j, lights, DARKNESS.night, room).step;
	return sum / 16;
}

describe('the lounge’s light', () => {
	it('is brightest at the lamp and falls away from it', () => {
		const near = mean(88, 38, [lamp]);
		const mid = mean(120, 50, [lamp]);
		expect(near).toBeGreaterThan(mid);
		expect(near).toBeGreaterThan(1);
	});

	it('leaves the corners dark at night', () => {
		expect(mean(0, 0, [lamp])).toBeLessThan(-1);
		expect(mean(300, 170, [lamp])).toBeLessThan(-1);
	});

	it('stays on its own surface', () => {
		expect(mean(88, 84, [lamp])).toBeLessThanOrEqual(mean(88, 76, [lamp]));
		const beam: Light = { ...lamp, y: 79, on: 'wall' };
		expect(stepAt(88, 90, [beam], DARKNESS.day, room).step).toBe(0);
	});

	it('names the moon only where the moon outshines the lamp', () => {
		const moon: Light = {
			x: 160,
			y: 100,
			rx: 80,
			ry: 30,
			power: 0.4,
			cool: true,
		};
		expect(stepAt(160, 100, [moon, lamp], DARKNESS.night, room).cool).toBe(
			true,
		);
		expect(stepAt(88, 40, [moon, lamp], DARKNESS.night, room).cool).toBe(false);
	});

	it('never steps past its bands', () => {
		const blaze: Light = { x: 90, y: 40, rx: 60, ry: 40, power: 9 };
		expect(stepAt(90, 40, [blaze], DARKNESS.night, room).step).toBe(BANDS);
	});
});
