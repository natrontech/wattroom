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
	/** A room's people line as the feed hands it over: names, and their ids. */
	const room = (names: string[], ids = names.map((n) => `id-${n}`)) => ({
		riders: names,
		riderIds: ids,
	});

	it('offers each rider the line named, by name', () => {
		const entries = railPeopleMenu(
			room(['Mara', 'Ines']),
			() => {},
			() => {},
		);
		expect(entries.map((e) => (e === 'separator' ? e : e.label))).toEqual([
			"Mara's page",
			"Ines's page",
		]);
	});

	it('opens the rider the FEED says that is, not the name (#649)', () => {
		const go = vi.fn();
		items(
			railPeopleMenu(room(['Dave', 'Dave'], ['u1', 'u2']), go, () => {}),
		)[1].onSelect();
		expect(go).toHaveBeenCalledWith('/u/u2');
	});

	it('sends the ones it could not name to the roster', () => {
		const onRoster = vi.fn();
		const entries = railPeopleMenu(
			room(['Mara', 'Ines', 'Bo', 'Kit', 'Rae']),
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
				room(['Mara', 'Ines', 'Bo']),
				() => {},
				() => {},
			),
		).toHaveLength(3);
	});

	it('counts a rider it has no id for rather than guessing one', () => {
		// The feed is a tick ahead of itself now and then; a name without an
		// id cannot become a page, and the roster is where they all have rows.
		const entries = railPeopleMenu(
			room(['Mara', 'Ines'], ['u1']),
			() => {},
			() => {},
		);
		const labels = items(entries).map((e) => e.label);
		expect(labels).toEqual(["Mara's page", 'Everyone who is here']);
		expect(items(entries).at(-1)!.hint).toBe('+1');
	});

	it('offers nothing when the feed named nobody it can open', () => {
		expect(
			railPeopleMenu(
				room(['Mara'], []),
				() => {},
				() => {},
			),
		).toEqual([]);
	});

	it('offers nothing for a room with nobody in it', () => {
		expect(
			railPeopleMenu(
				room([]),
				() => {},
				() => {},
			),
		).toEqual([]);
	});
});
