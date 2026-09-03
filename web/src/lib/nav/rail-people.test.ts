import { describe, expect, it, vi } from 'vitest';
import type { MenuItem } from '$lib/context-menu.svelte';
import {
	RAIL_NAMES,
	railPeople,
	railPeopleMenu,
	railSubline,
} from './rail-people';

const items = (entries: ReturnType<typeof railPeopleMenu>) =>
	entries.filter((entry): entry is MenuItem => entry !== 'separator');

describe('railSubline', () => {
	it('says nothing under the room you are standing in', () => {
		expect(railSubline({ session: undefined, riders: ['Mara'] }, true)).toBe(
			null,
		);
	});

	it('puts the running session ahead of the people in it', () => {
		expect(
			railSubline(
				{
					session: { workoutName: 'Sweet Spot', elapsedSec: 700 },
					riders: ['Mara'],
				},
				false,
			),
		).toBe('session');
	});

	it('names the people when nothing is running', () => {
		expect(railSubline({ riders: ['Mara', 'Ines'] }, false)).toBe('people');
	});

	it('falls back to the next planned ride in an empty room', () => {
		expect(
			railSubline(
				{ riders: [], next: { workoutName: 'Threshold', startsAt: 'x' } },
				false,
			),
		).toBe('next');
	});

	it('says nothing about a quiet room with nothing planned', () => {
		expect(railSubline({}, false)).toBe(null);
	});
});

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

describe('railPeopleMenu', () => {
	it('offers each rider the line named, by name', () => {
		const entries = railPeopleMenu(
			['Mara', 'Ines'],
			() => {},
			() => {},
		);
		expect(entries.map((e) => (e === 'separator' ? e : e.label))).toEqual([
			"Mara's page",
			"Ines's page",
		]);
	});

	it('opens the rider the entry names', () => {
		const onMember = vi.fn();
		items(railPeopleMenu(['Mara', 'Ines'], onMember, () => {}))[1].onSelect();
		expect(onMember).toHaveBeenCalledWith('Ines');
	});

	it('sends the ones it could not name to the roster', () => {
		const onRoster = vi.fn();
		const entries = railPeopleMenu(
			['Mara', 'Ines', 'Bo', 'Kit', 'Rae'],
			() => {},
			onRoster,
		);
		expect(entries).toContain('separator');
		const last = items(entries).at(-1)!;
		expect(last.label).toBe('Everyone who is here');
		expect(last.hint).toBe('+2');
		last.onSelect();
		expect(onRoster).toHaveBeenCalled();
	});

	it('leaves the roster out when it named everybody', () => {
		expect(
			railPeopleMenu(
				['Mara', 'Ines', 'Bo'],
				() => {},
				() => {},
			),
		).toHaveLength(3);
	});

	it('offers nothing when the rail was given no way to open a rider', () => {
		expect(railPeopleMenu(['Mara'], undefined, () => {})).toEqual([]);
	});

	it('offers nothing for a room with nobody in it', () => {
		expect(
			railPeopleMenu(
				[],
				() => {},
				() => {},
			),
		).toEqual([]);
	});
});
