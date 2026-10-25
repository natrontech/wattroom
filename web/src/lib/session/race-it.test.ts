import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { StoredRoute } from '$lib/road/stored';
import GameList from './GameList.svelte';
import RaceStart from './RaceStart.svelte';
import RoutePicker from './RoutePicker.svelte';
import { RACES, raceStart } from './modes';

vi.mock('$lib/ride/roads', () => ({ loadRoad: () => new Promise(() => {}) }));

describe('a race asked of the hub (#3777)', () => {
	it.each([
		['race', 20, 30, { gameMode: 'race' }],
		['last-light', 10, 30, { gameMode: 'last-light', minutes: 10 }],
		['wheelrace', 20, 15, { gameMode: 'wheelrace', minutes: 15 }],
		['wheelrace', 20, 45, { gameMode: 'wheelrace', minutes: 45 }],
		// The hub refuses these pars, so no Start is offered for them.
		['wheelrace', 20, 14, null],
		['wheelrace', 20, 46, null],
		['wheelrace', 20, 22.5, null],
		['wheelrace', 20, null, null],
	])('%s on %d min, par %s', (mode, clock, par, want) => {
		expect(raceStart(mode, clock, par)).toEqual(want);
	});
});

const road: StoredRoute = {
	id: 'r1',
	name: 'Test road',
	generatedName: 'Road · 7.1 km · 571 m',
	src: 'gpx',
	lengthM: 7100,
	gainM: 571,
	climbs: [],
	hasPlace: false,
	ownerOnly: false,
	createdAt: '2026-10-01T00:00:00Z',
};

const roads = (racing: boolean, how: 'together' | 'race') =>
	render(RoutePicker, {
		props: {
			routes: [road],
			error: null,
			onRetry: () => {},
			choice: null,
			how,
			racing,
			footer: (() => {}) as never,
		},
	}).body;

describe('Race it on the Roads tab (#3777)', () => {
	it('offers the three races, named and told as modes.ts has them', () => {
		const body = roads(true, 'race');
		expect(body).toContain('which race');
		for (const race of RACES) {
			expect(body).toContain(race.label);
			expect(body).toContain(race.blurb);
		}
		// A race rides the whole road: no stretch to pick.
		expect(body).not.toContain('which stretch');
	});

	it('is held, and says why, where a race cannot start', () => {
		const body = roads(false, 'race');
		expect(body).toMatch(/<button[^>]*disabled[^>]*>Race it<\/button>/);
		expect(body).toContain('A race starts now, from the screen you ride on.');
		expect(body).not.toContain('which race');
	});
});

describe('the race’s Start (#3777)', () => {
	const start = (gameRunning: boolean, sessionOpen: boolean) =>
		render(RaceStart, {
			props: {
				race: { gameMode: 'last-light', minutes: 20, route: { id: 'r1' } },
				channelName: 'Lounge',
				gameRunning,
				sessionOpen,
				busy: false,
				onStart: () => {},
			},
		}).body;

	it('names the race it starts', () => {
		expect(start(false, false)).toMatch(
			/<button(?![^>]*disabled)[^>]*>Start Last Light<\/button>/,
		);
	});

	it.each([
		[true, false, 'A game is running'],
		[false, true, 'A session is running'],
	])(
		'is held while a game (%s) or a session (%s) holds the channel',
		(game, session, why) => {
			const body = start(game, session);
			expect(body).toMatch(/<button[^>]*disabled[^>]*>Start Last Light/);
			expect(body).toContain(why);
		},
	);
});

describe('the Games tab (#3777)', () => {
	it('sends a rider looking for a race to the roads', () => {
		const body = render(GameList, {
			props: { running: false, onStart: () => {}, onRace: () => {} },
		}).body;
		expect(body).toContain(
			'Races ride one of your roads: Race · Last Light · Wheelrace.',
		);
		expect(body).toContain('Race on a road');
	});
});
