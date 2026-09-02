import { describe, expect, it } from 'vitest';
import { rosterGroups } from './roster';
import type { RoomMember, RoomRider } from './view';

const rider = (id: string, over: Partial<RoomRider> = {}): RoomRider =>
	({ id, name: id, watts: 0, inVoice: false, ...over }) as RoomRider;
const member = (id: string): RoomMember => ({ id, displayName: id });

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
});
