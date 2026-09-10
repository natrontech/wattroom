import { describe, expect, it } from 'vitest';
import {
	deleteRoomBody,
	joinedOn,
	memberCount,
	ownerName,
	packLabel,
	type RoomMember,
} from './settings-summary';

const packs = [
	{ id: 'base', label: 'Base' },
	{ id: 'silent', label: 'Silent' },
];

const rider = (over: Partial<RoomMember> = {}): RoomMember => ({
	id: 'r-1',
	displayName: 'Rider',
	role: 'member',
	...over,
});

describe('memberCount', () => {
	// The one that fails silently. rooms.go keeps banned riders off every
	// roster BUT the owner's, so counting the array gives the owner and a
	// member two different totals for one room — and the owner's is the wrong
	// one. Nothing errors; the number is just quietly too big, for the person
	// least likely to doubt it.
	it('leaves banned riders out', () => {
		const roster = [
			rider({ id: 'a', role: 'owner' }),
			rider({ id: 'b' }),
			rider({ id: 'c', role: 'banned' }),
			rider({ id: 'd', role: 'banned' }),
		];
		expect(memberCount(roster)).toBe(2);
	});

	it('counts coaches, who are members who run sessions', () => {
		expect(
			memberCount([
				rider({ id: 'a', role: 'owner' }),
				rider({ id: 'b', role: 'coach' }),
			]),
		).toBe(2);
	});

	it('is 0 for an empty roster rather than throwing', () => {
		expect(memberCount([])).toBe(0);
	});
});

describe('ownerName', () => {
	it('finds the owner wherever they sit in the roster', () => {
		expect(
			ownerName([
				rider({ id: 'a' }),
				rider({ id: 'b', displayName: 'Jan', role: 'owner' }),
			]),
		).toBe('Jan');
	});

	// A roster that has not loaded, or one where the owner left mid-request:
	// the line still reads as a sentence rather than "undefined owns it".
	it('falls back to a word, not undefined', () => {
		expect(ownerName([])).toBe('somebody');
		expect(ownerName([rider()])).toBe('somebody');
	});
});

describe('joinedOn', () => {
	it('finds the viewer, not the first rider', () => {
		const roster = [
			rider({ id: 'a', joinedAt: '2026-01-01' }),
			rider({ id: 'b', joinedAt: '2026-08-12' }),
		];
		expect(joinedOn(roster, 'b')).toBe('2026-08-12');
	});

	// The account store loads separately from the room, so the viewer's id is
	// routinely undefined on the first render. The clause has to drop, not
	// render "you joined undefined".
	it('says nothing when the viewer is unknown', () => {
		expect(
			joinedOn([rider({ id: 'a', joinedAt: '2026-01-01' })], undefined),
		).toBeUndefined();
	});

	it('says nothing when the viewer is not on the roster', () => {
		expect(joinedOn([rider({ id: 'a' })], 'z')).toBeUndefined();
	});
});

describe('packLabel', () => {
	it('names the pack', () => {
		expect(packLabel(packs, 'silent')).toBe('Silent');
	});

	it('defaults to base, which is what a room with no pack set runs', () => {
		expect(packLabel(packs, undefined)).toBe('Base');
	});

	// A room saved by a newer version should read oddly rather than blankly:
	// an empty cell says "this room has no sound", which is a different and
	// wrong statement.
	it('shows an unknown pack rather than an empty cell', () => {
		expect(packLabel(packs, 'thunderdome')).toBe('thunderdome');
	});
});

describe('deleteRoomBody', () => {
	// The silent one. Deleting the last room of a crew nobody else is in
	// deletes the crew — its name, its logo and its invite link — and the
	// confirm said nothing about it either way, so the crew simply was not
	// there afterwards (#1935).
	it('says the crew goes when the server says it does', () => {
		const body = deleteRoomBody({ name: 'Watt Club', goesWithRoom: true });
		expect(body).toContain('Watt Club');
		expect(body).toContain('the crew goes with it');
	});

	// And never otherwise: a crew with another room or another person in it
	// survives, and promising its end would be the same lie the other way up.
	it('says nothing about the crew when the crew survives', () => {
		for (const crew of [
			undefined,
			{ name: 'Watt Club' },
			{ name: 'Watt Club', goesWithRoom: false },
		]) {
			const body = deleteRoomBody(crew);
			expect(body).not.toContain('crew');
			expect(body).toContain("This can't be undone.");
		}
	});
});
