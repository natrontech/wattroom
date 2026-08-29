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
		expect(wireMetrics(metrics, true, 1).hr).toBe(148);
	});

	it('drops heart rate at the door when sharing is off — everything else untouched', () => {
		const wire = wireMetrics(metrics, false, 2);
		expect(wire).toEqual({ watts: 210, cadence: 88, hr: 0, seq: 2 });
	});

	it('resumes the moment sharing is back on — the toggle is per sample', () => {
		expect(wireMetrics(metrics, false, 3).hr).toBe(0);
		expect(wireMetrics(metrics, true, 4).hr).toBe(148);
	});

	it('sends zero, the wire absent, when nothing reports HR', () => {
		expect(wireMetrics({ ...metrics, heartRate: undefined }, true, 5).hr).toBe(
			0,
		);
	});
});
