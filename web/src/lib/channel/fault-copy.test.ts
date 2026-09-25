import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

// One trainer dropout, one way of saying it (#2881 L6-08, ADR-0046): a
// session drew an amber "Trainer disconnected" card with no button, solo a
// red "Trainer signal lost — reconnecting" banner that said "reconnecting"
// again on the line under it.
describe('a trainer fault reads the same on every riding surface', () => {
	it('names what happened and always offers the chooser back', () => {
		for (const state of [
			'reconnecting',
			'lost',
			'silent',
			'no-power',
		] as const) {
			const said = faultCopy({ kind: 'trainer', state });
			expect(said.title).toMatch(/^Trainer/);
			expect(said.action).toMatch(/^Pair /);
		}
	});

	it('the solo ride and the ramp draw the session’s banner', () => {
		const status = readFileSync(
			join(import.meta.dirname, '../ride/RideStatus.svelte'),
			'utf8',
		);
		expect(status).toContain('<FaultBanner');
		expect(status).not.toMatch(/signal lost|reconnecting on its own/i);
	});
});
