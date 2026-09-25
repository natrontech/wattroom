import { describe, expect, it } from 'vitest';
import { faultCopy } from '$lib/channel/fault-copy';

/**
 * A dropped channel says how much riding this device is holding (#2855) —
 * but only when there is a ride: on a voice channel with no trainer it
 * promised stored riding that did not exist.
 */
describe('faultCopy for a dropped channel', () => {
	const states = ['offline', 'reconnecting', 'lost'] as const;

	it.each(states)(
		'%s names the riding buffered here during a ride',
		(state) => {
			const { detail } = faultCopy({ kind: 'channel', state }, 184);
			expect(detail).toContain('3:04');
		},
	);

	it.each(states)('%s promises no stored riding without a ride', (state) => {
		const { detail } = faultCopy({ kind: 'channel', state });
		expect(detail).not.toMatch(/riding|stored|buffered|0:00/);
		expect(detail.length).toBeGreaterThan(20);
	});
});
