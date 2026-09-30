import { describe, expect, it } from 'vitest';
import { makeGround, SUBGRADE } from './ground';
import type { Line } from './lines';
import { FORMATION } from './road-profile';

/**
 * One straight road at 1,000 m over a height model 100 m below it, and one
 * 100 m above: the embankment and the cutting a road makes, alone, where
 * nothing else can explain a step (#3075).
 */

const xs = Array.from({ length: 1001 }, (_, i) => i * 2);
const road: Line = {
	key: 'straight',
	x: xs,
	z: xs.map(() => 0),
	h: xs.map(() => 1000),
};
const SALT = [1, 2, 3, 4] as const;

describe.each([
	['an embankment', 900],
	['a cutting', 1100],
])('%s', (_, model) => {
	const g = makeGround([road], { salt: SALT, model: () => model });

	it('runs from the road to the height model without a step', () => {
		// The steepest it may be is the 1:1 cut: 0.25 m in 25 cm.
		const steps: string[] = [];
		// On a vertex the sparse cones are exact; midway between two they are loosest.
		for (const [x, side] of [
			[1000, -1],
			[1000, 1],
			[1010, -1],
			[1010, 1],
		]) {
			let prev = g.heightAt(x, 0);
			for (let u = 0.25; u <= 500; u += 0.25) {
				const h = g.heightAt(x, side * u);
				if (Math.abs(h - prev) > 0.3)
					steps.push(`${(h - prev).toFixed(1)} m at ${u} m`);
				prev = h;
			}
		}
		expect(steps).toEqual([]);
	});

	it('sits the road on its formation and slopes away at the earthwork’s own grade', () => {
		expect(g.heightAt(1000, FORMATION - 0.1)).toBeCloseTo(1000 - SUBGRADE, 6);
		// Well inside the slope, where the soft clamp has let go: 1.5:1 fill, 1:1 cut after a 7 m bench.
		const at = 4.8 + 40;
		const slope = model < 1000 ? -0.667 * 40 : 40 - 7;
		expect(g.heightAt(1000, at)).toBeCloseTo(1000 - SUBGRADE + slope, 1);
	});

	it('keeps the verge flat: nothing rises off the bench beside the road', () => {
		let worst = -Infinity;
		for (let u = FORMATION; u <= FORMATION + 7; u += 0.05)
			worst = Math.max(worst, g.heightAt(1010, u) - (1000 - SUBGRADE));
		expect(worst).toBeLessThanOrEqual(1e-9);
	});

	it('is the height model once the earthwork has reached it', () => {
		expect(g.heightAt(1000, 450)).toBeCloseTo(model, 6);
	});
});
