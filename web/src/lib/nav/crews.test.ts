import { describe, expect, it } from 'vitest';
import {
	administersNone,
	foundedCount,
	leadsWithJoining,
	openableCrews,
} from './crews';

const natron = { id: 'c1', name: 'Natron', role: 'owner' as const };
const sunday = { id: 'c2', name: 'Sunday Long', role: 'member' as const };

describe('who may make what', () => {
	const admined = { id: 'c3', name: 'Tuesday', role: 'admin' as const };
	const crews = [natron, sunday, admined];

	it('offers the crews you own or administer, never one you only ride in', () => {
		expect(openableCrews(crews).map((c) => c.id)).toEqual(['c1', 'c3']);
	});
	// Three surfaces asked this three ways (#2176): Home's button asked "any
	// crew at all", which is true for a plain member of somebody else's, so
	// they were offered "Open a room" and handed a sheet that led with joining
	// one — and the dialog between them asked nothing and was always "Open a
	// room".
	it('says a rider administers no crew, membership alone not counting', () => {
		expect(administersNone([])).toBe(true);
		expect(administersNone([sunday])).toBe(true);
		expect(administersNone([natron])).toBe(false);
		expect(administersNone([admined])).toBe(false);
		expect(administersNone(crews)).toBe(false);
	});
	// The landing's one CTA is "Start your crew" (routes/+page.svelte),
	// and #2144 keyed the sheet's order on administering nothing — so every
	// stranger who took the front door at its word met a code box (#2184).
	it('leads with joining only for a rider carrying an invite', () => {
		expect(leadsWithJoining([], 'AB23CD')).toBe(true);
		expect(leadsWithJoining([sunday], 'AB23CD')).toBe(true);
		expect(leadsWithJoining([], undefined)).toBe(false);
		expect(leadsWithJoining([], null)).toBe(false);
		expect(leadsWithJoining([], '')).toBe(false);
		expect(leadsWithJoining([sunday], undefined)).toBe(false);
	});
	// The invite rides the account, read once; the crew list moves first. A
	// rider who founds a crew in-session still carries the stale code.
	it('stops leading with joining once the rider has a crew of their own', () => {
		expect(leadsWithJoining([natron], 'AB23CD')).toBe(false);
		expect(leadsWithJoining(crews, 'AB23CD')).toBe(false);
	});
	// Silent if it breaks: "Start a crew" would disable a slot early or
	// offer a POST the server refuses. Seen red in the PR.
	it('counts toward the founding cap only what you founded and still own', () => {
		const founded = { ...natron, founded: true };
		const handedOn = { ...sunday, founded: true };
		const handedToYou = { id: 'c8', name: 'Handed', role: 'owner' as const };
		expect(foundedCount([founded, handedOn, handedToYou, admined])).toBe(1);
	});
});
