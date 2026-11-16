import { describe, expect, it } from 'vitest';

import { pickable } from './ride-choice';
import type { ShelfEntry } from '#lib/workout/shelf.ts';

const entry = (id: string, more: Partial<ShelfEntry> = {}): ShelfEntry => ({
	id,
	yours: false,
	workout: { name: id, steps: [] },
	...more,
});

// The ride sheet offers six (#4616): what a rider most likely came to ride
// first, and never loses the one a door already chose.
describe('pickable', () => {
	const shelf = [
		entry('lib1'),
		entry('lib2', { recent: true }),
		entry('own1', { yours: true }),
		entry('lib3'),
		entry('lib4'),
		entry('lib5'),
		entry('lib6'),
		entry('lib7'),
	];

	it('puts today’s plan first, then your own, then what you rode lately', () => {
		expect(pickable(shelf, ['lib5'], null).map((e) => e.id)).toEqual([
			'lib5',
			'own1',
			'lib2',
			'lib1',
			'lib3',
			'lib4',
		]);
	});

	it('keeps a door’s workout even when it ranks below the six', () => {
		const ids = pickable(shelf, [], 'lib7').map((e) => e.id);
		expect(ids).toHaveLength(6);
		expect(ids).toContain('lib7');
		expect(ids[0]).toBe('own1');
	});
});
