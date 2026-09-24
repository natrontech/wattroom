import { describe, expect, it } from 'vitest';
import type { LiveChannel, LiveOccupant } from '$lib/crews-live';
import { arrived, occupantsWithMoves, type MoveInFlight } from './voice-move';

const rider = (name: string): LiveOccupant => ({
	id: name.toLowerCase(),
	name,
});
const voice = (id: string, ...names: string[]): LiveChannel => ({
	id,
	kind: 'voice',
	name: id,
	occupants: names.map(rider),
});
const names = (m: Map<string, LiveOccupant[]>, id: string) =>
	(m.get(id) ?? []).map((o) => o.name);

describe('occupantsWithMoves', () => {
	it('draws a move in flight at its destination, in the hub’s order', () => {
		const channels = [voice('cave', 'Ana', 'Kim'), voice('lair', 'Ben', 'Zoe')];
		const move: MoveInFlight = {
			rider: rider('Kim'),
			from: 'cave',
			to: 'lair',
		};
		const shown = occupantsWithMoves(channels, [move]);
		expect(names(shown, 'cave')).toEqual(['Ana']);
		expect(names(shown, 'lair')).toEqual(['Ben', 'Kim', 'Zoe']);
	});

	it('changes nothing once the rider has arrived', () => {
		const channels = [voice('cave', 'Ana'), voice('lair', 'Kim')];
		const move: MoveInFlight = {
			rider: rider('Kim'),
			from: 'cave',
			to: 'lair',
		};
		expect(arrived(channels, move)).toBe(true);
		const shown = occupantsWithMoves(channels, [move]);
		expect(names(shown, 'cave')).toEqual(['Ana']);
		expect(names(shown, 'lair')).toEqual(['Kim']);
	});

	it('keeps a rider in one channel even when the server lists them twice mid-switch', () => {
		// Their old socket has not closed yet while the new one is not open.
		const channels = [voice('cave', 'Kim'), voice('lair'), voice('den', 'Kim')];
		const move: MoveInFlight = {
			rider: rider('Kim'),
			from: 'cave',
			to: 'lair',
		};
		const shown = occupantsWithMoves(channels, [move]);
		expect(names(shown, 'lair')).toEqual(['Kim']);
		expect(names(shown, 'cave')).toEqual([]);
		expect(names(shown, 'den')).toEqual([]);
	});

	it('lands a rider who left the source before the server heard the move', () => {
		const channels = [voice('cave'), voice('lair')];
		const move: MoveInFlight = {
			rider: rider('Kim'),
			from: 'cave',
			to: 'lair',
		};
		expect(names(occupantsWithMoves(channels, [move]), 'lair')).toEqual([
			'Kim',
		]);
	});
});
