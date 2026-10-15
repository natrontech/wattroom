import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HOLD_S, makeReveal, REVEAL } from './reveal';

// A straight road along +z, climbing 5 % from its start.
const point = (d: number) => new THREE.Vector3(0, d * 0.05, d);
const reveal = makeReveal(point, 2000);

function shot(left: number, total: number, still = false) {
	const eye = new THREE.Vector3();
	const quat = new THREE.Quaternion();
	const gaze = new THREE.Vector3();
	reveal({ left, total, still }, eye, quat, gaze);
	return { eye, quat };
}

describe('the count-in reveal', () => {
	it('opens 200 m back and 100 m up, and stands still for the last 3 s', () => {
		const open = shot(10, 10);
		expect(open.eye.z).toBeCloseTo(-REVEAL.back);
		expect(open.eye.y).toBeCloseTo(-REVEAL.back * 0.05 + REVEAL.up);
		const a = shot(HOLD_S, 10);
		const b = shot(0.1, 10);
		expect(a.eye.distanceTo(b.eye)).toBeLessThan(1e-4);
		expect(a.eye.z).toBeCloseTo(-REVEAL.hold.back);
	});

	it('never moves faster than 60 m/s or turns faster than 20°/s', () => {
		const dt = 0.05;
		for (const total of [10, 5]) {
			let prev = shot(total, total);
			for (let left = total - dt; left >= 0; left -= dt) {
				const next = shot(left, total);
				expect(prev.eye.distanceTo(next.eye) / dt).toBeLessThanOrEqual(
					REVEAL.maxMps,
				);
				expect(
					THREE.MathUtils.radToDeg(prev.quat.angleTo(next.quat)) / dt,
				).toBeLessThanOrEqual(REVEAL.maxDegPerS);
				prev = next;
			}
		}
	});

	it('lands a late opener mid-path', () => {
		const open = shot(10, 10).eye.z;
		const mid = shot(6, 10).eye.z;
		expect(mid).toBeGreaterThan(open);
		expect(mid).toBeLessThan(-REVEAL.hold.back);
	});

	it('holds one still frame, the hold pose, under reduced motion', () => {
		const hold = shot(HOLD_S, 10);
		for (const left of [10, 7, 1]) {
			const s = shot(left, 10, true);
			expect(s.eye.distanceTo(hold.eye)).toBeLessThan(1e-4);
			expect(s.quat.angleTo(hold.quat)).toBeLessThan(1e-3);
		}
	});

	it('is all hold when the count-in is no longer than the hold', () => {
		expect(shot(3, 3).eye.z).toBeCloseTo(-REVEAL.hold.back);
	});
});
