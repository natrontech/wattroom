import { describe, expect, it } from 'vitest';
import { elsewhereIn, rosterGroups } from './roster';
import type { LiveCrew } from '$lib/crews-live';
import type { PanelMember, LiveRider } from '$lib/channel/types';

const rider = (id: string, over: Partial<LiveRider> = {}): LiveRider =>
	({ id, name: id, watts: 0, inVoice: false, ...over }) as LiveRider;
const member = (id: string): PanelMember => ({ id, displayName: id });

describe('rosterGroups', () => {
	it('splits on voice in the lounge', () => {
		const groups = rosterGroups(
			false,
			[rider('a', { inVoice: true }), rider('b', { watts: 200 })],
			[member('a'), member('b'), member('c')],
		);
		expect(groups.here.map((r) => r.id)).toEqual(['a']);
		expect(groups.away.map((r) => r.id)).toEqual(['b']);
		expect(groups.offline.map((m) => m.id)).toEqual(['c']);
	});

	it('splits on pedalling mid-ride', () => {
		const groups = rosterGroups(
			true,
			[rider('a', { inVoice: true }), rider('b', { watts: 200 })],
			[],
		);
		expect(groups.here.map((r) => r.id)).toEqual(['b']);
		expect(groups.away.map((r) => r.id)).toEqual(['a']);
	});

	it('counts a connected rider who is not a member as here, never offline', () => {
		// The roster is the live truth; the member list can lag a fresh join.
		const groups = rosterGroups(false, [rider('a', { inVoice: true })], []);
		expect(groups.here).toHaveLength(1);
		expect(groups.offline).toEqual([]);
	});

	it("names a member in another of the crew's channels instead of calling them offline (#2536)", () => {
		const crew = {
			id: 'velvet',
			channels: [
				{
					id: 'lounge',
					kind: 'voice',
					name: 'Lounge',
					occupants: [{ id: 'a', name: 'a' }],
				},
				{
					id: 'garage',
					kind: 'voice',
					name: 'Garage',
					occupants: [{ id: 'b', name: 'b', riding: true }],
				},
				{ id: 'chat', kind: 'text', name: 'chat' },
			],
		} as unknown as LiveCrew;
		const groups = rosterGroups(
			false,
			[rider('a', { inVoice: true })],
			[member('a'), member('b'), member('c')],
			elsewhereIn(crew, 'lounge'),
		);
		expect(groups.here.map((r) => r.id)).toEqual(['a']);
		expect(groups.elsewhere).toEqual([
			{ id: 'b', displayName: 'b', channel: 'Garage', status: 'riding' },
		]);
		expect(groups.offline.map((m) => m.id)).toEqual(['c']);
	});
});
