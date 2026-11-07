import { describe, expect, it } from 'vitest';
import { PEDAL_FRAMES, crankAngle } from '$lib/lounge/draw-rider';

describe('the crank', () => {
	it('pedals forward: the front foot goes down as the stroke runs on', () => {
		// At stroke 0 the right foot is at the front (+x). A frame later it is lower.
		expect(Math.cos(crankAngle(0))).toBeCloseTo(1);
		expect(Math.sin(crankAngle(1))).toBeLessThan(0);
		// And the top of the stroke comes after the back, never before it.
		expect(Math.sin(crankAngle(PEDAL_FRAMES * 0.75))).toBeCloseTo(1);
	});
});
