import { describe, expect, it } from 'vitest';
import { nextLeg } from './leg';

describe('the next leg offer (#3601)', () => {
	it('offers the following leg while the route runs on', () => {
		expect(nextLeg('r 1', 1, 3)).toEqual({
			label: 'Ride leg 2 of 3',
			href: '/ride?road=r%201&leg=2',
		});
	});
	it('offers nothing at the last leg or a single one', () => {
		expect(nextLeg('r', 3, 3)).toBeNull();
		expect(nextLeg('r', 1, 1)).toBeNull();
	});
});
