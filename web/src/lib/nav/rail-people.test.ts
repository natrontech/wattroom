import { describe, expect, it } from 'vitest';
import { RAIL_NAMES, railPeople } from './rail-people';

describe('railPeople', () => {
	it('prints every name while they fit', () => {
		expect(railPeople(['Mara', 'Ines'])).toEqual({
			shown: ['Mara', 'Ines'],
			more: 0,
			label: 'Mara, Ines',
		});
	});

	it('counts the ones it had no width for', () => {
		expect(railPeople(['Mara', 'Ines', 'Bo', 'Kit', 'Rae'])).toEqual({
			shown: ['Mara', 'Ines', 'Bo'],
			more: 2,
			label: 'Mara, Ines, Bo +2',
		});
	});

	it('adds no count at exactly the width', () => {
		expect(railPeople(['Mara', 'Ines', 'Bo']).label).toBe('Mara, Ines, Bo');
	});

	it('handles a room the presence store has no names for', () => {
		expect(railPeople(undefined)).toEqual({ shown: [], more: 0, label: '' });
	});

	it('prints three names', () => {
		expect(RAIL_NAMES).toBe(3);
	});
});
