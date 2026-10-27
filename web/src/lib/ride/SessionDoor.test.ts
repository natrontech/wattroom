import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import SessionDoor from './SessionDoor.svelte';

const state = vi.hoisted(() => ({ spectator: false, crews: [] as unknown[] }));
vi.mock('$app/navigation', () => ({ goto: () => {} }));
vi.mock('$lib/device.svelte', () => ({
	device: {
		get spectator() {
			return state.spectator;
		},
	},
}));
vi.mock('$lib/nav/crew-live.svelte', () => ({
	crewLive: {
		loaded: true,
		get crews() {
			return state.crews;
		},
		reload: () => Promise.resolve(),
	},
}));

const crew = {
	id: 'c1',
	name: 'Crew',
	role: 'member',
	channels: [{ id: 'v1', kind: 'voice', name: 'Lounge' }],
};
const door = () =>
	render(SessionDoor, { props: { pick: 'openers', road: 'r1' } }).body;

describe('the session door on /ride (#4224)', () => {
	it('opens the lounge on a desk', () => {
		state.spectator = false;
		state.crews = [crew];
		expect(door()).toContain('Start a session in Lounge');
	});

	it('is absent on a phone, which only plans (#1767)', () => {
		state.spectator = true;
		state.crews = [crew];
		expect(door()).not.toContain('Start a session');
	});

	it('is absent with no lounge to open', () => {
		state.spectator = false;
		state.crews = [];
		expect(door()).not.toContain('Start a session');
	});
});
