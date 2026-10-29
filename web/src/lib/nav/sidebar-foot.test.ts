import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/**
 * The sidebar's foot, top to bottom (TARGETS ride-dock 2, ADR-0093 point
 * 5): the call, the ride dock, the update row, you.
 */
it('docks the ride below the call and above the update row and you', () => {
	const source = readFileSync(
		join(import.meta.dirname, 'Sidebar.svelte'),
		'utf8',
	);
	const at = ['<VoiceStrip', '<RideDock', '<UpdateRow', '<YouPanel'].map(
		(tag) => source.indexOf(tag),
	);
	expect(at.every((i) => i >= 0)).toBe(true);
	expect([...at].sort((a, b) => a - b)).toEqual(at);
});
