import { describe, expect, it } from 'vitest';
import { wireMetrics } from './wire';

const metrics = {
	watts: 210,
	cadence: 88,
	heartRate: 148,
	from: {},
};

describe('wireMetrics', () => {
	it('carries heart rate while sharing', () => {
		expect(wireMetrics(metrics, true).hr).toBe(148);
	});

	it('drops heart rate at the door when sharing is off — everything else untouched', () => {
		const wire = wireMetrics(metrics, false);
		expect(wire).toEqual({
			watts: 210,
			cadence: 88,
			hr: 0,
			bias: 1,
			released: false,
		});
	});

	it('resumes the moment sharing is back on — the toggle is per sample', () => {
		expect(wireMetrics(metrics, false).hr).toBe(0);
		expect(wireMetrics(metrics, true).hr).toBe(148);
	});

	it('sends zero, the wire absent, when nothing reports HR', () => {
		expect(wireMetrics({ ...metrics, heartRate: undefined }, true).hr).toBe(0);
	});
});

describe('the trim that rides with every sample (#795)', () => {
	it("carries the rider's bias, so the room scores the plan they were on", () => {
		expect(wireMetrics(metrics, false, 0.8).bias).toBe(0.8);
		// A caller that says nothing rides at 1 — the prescribed target.
		expect(wireMetrics(metrics, false).bias).toBe(1);
	});
});
