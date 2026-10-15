import { describe, expect, it } from 'vitest';
import { H, W, verdict, type Frame } from './flash';

/** A field of one colour, 100 ms apart, painted by `colour(t)`. */
function field(
	seconds: number,
	colour: (t: number) => [number, number, number],
): Frame[] {
	return Array.from({ length: seconds * 10 }, (_, i) => {
		const rgb = new Uint8Array(W * H * 3);
		const c = colour(i * 100);
		for (let p = 0; p < W * H; p++) rgb.set(c, p * 3);
		return { t: i * 100, rgb };
	});
}

const WATT: [number, number, number] = [255, 0, 170];
const DARK: [number, number, number] = [10, 5, 30];
const RED: [number, number, number] = [255, 0, 0];

describe('the flash gate', () => {
	it('is red on a 4 Hz watt blink', () => {
		const v = verdict(field(3, (t) => (Math.floor(t / 125) % 2 ? DARK : WATT)));
		expect(v.perSecond).toBeGreaterThanOrEqual(3);
		expect(v.per10s).toBeGreaterThan(1);
	});

	it('is red on a 4 Hz saturated red blink', () => {
		const v = verdict(field(3, (t) => (Math.floor(t / 125) % 2 ? DARK : RED)));
		expect(v.perSecond).toBeGreaterThanOrEqual(3);
	});

	it('passes a steady field and one slow flash', () => {
		expect(verdict(field(5, () => WATT)).times).toEqual([]);
		const slow = verdict(
			field(10, (t) => (t < 3000 || t > 3500 ? DARK : WATT)),
		);
		expect(slow.per10s).toBeLessThanOrEqual(1);
	});
});
