import { describe, expect, it } from 'vitest';
import {
	BARS_PER_GROUP,
	GUTTER,
	powerCurveGeometry,
} from './power-curve-geometry';

const GROUPS = 4;

describe('powerCurveGeometry', () => {
	for (const measured of [240, 295, 340, 375, 600, 900, 1400]) {
		it(`keeps groups apart and inside the chart at ${measured} px`, () => {
			const g = powerCurveGeometry(measured, GROUPS);
			expect(g.barW).toBeGreaterThan(0);
			for (let wi = 0; wi < GROUPS; wi++) {
				const left = g.barX(wi, 0);
				const right = g.barX(wi, BARS_PER_GROUP - 1) + g.barW;
				expect(left).toBeGreaterThanOrEqual(GUTTER);
				expect(right).toBeLessThanOrEqual(g.width);
				if (wi > 0) {
					const prevRight = g.barX(wi - 1, BARS_PER_GROUP - 1) + g.barW;
					expect(left).toBeGreaterThan(prevRight);
				}
			}
		});
	}

	it('grows the chart past a too-narrow measure instead of crowding', () => {
		expect(powerCurveGeometry(100, GROUPS).width).toBeGreaterThan(100);
	});
});
