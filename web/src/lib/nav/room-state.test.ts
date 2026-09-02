import { describe, expect, it } from 'vitest';
import { roomNavState } from './room-state';

describe('roomNavState', () => {
	it('prioritizes the room the rider is standing in', () => {
		expect(roomNavState('ride', 'ride', 'ride', false)).toBe('connected');
	});

	it('marks an active room as browsing when it is not connected', () => {
		expect(roomNavState('ride', 'ride', '', false)).toBe('browsing');
	});

	it('marks a room chat opened from outside as browsing', () => {
		expect(roomNavState('ride', '', '', true)).toBe('browsing');
	});

	it('leaves other rooms idle', () => {
		expect(roomNavState('other', 'ride', 'ride', false)).toBe('idle');
	});
});
