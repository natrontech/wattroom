import { describe, expect, it } from 'vitest';
import { gameDoor, takeGameDoor } from './game-door';

describe('the game door (#3276)', () => {
	it('carries one mode to the lounge, and comes off the address once taken', () => {
		const href = gameDoor('/crew/c1/v/v1', 'watt-golf');
		expect(href).toBe('/crew/c1/v/v1?game=watt-golf');
		const door = takeGameDoor(new URL(href + '&voice=1', 'http://x'))!;
		expect(door.mode).toBe('watt-golf');
		expect(door.rest.pathname + door.rest.search).toBe('/crew/c1/v/v1?voice=1');
		expect(takeGameDoor(new URL('http://x/crew/c1/v/v1'))).toBeNull();
	});
});
