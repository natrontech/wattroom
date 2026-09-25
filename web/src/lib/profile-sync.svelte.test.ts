import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProfile, type Profile } from '$lib/profile.svelte';

const signedIn = vi.hoisted(() => ({
	me: null as null | {
		id: string;
		displayName: string;
		ftpWatts: number;
		weightKg: number;
		lthr?: number;
	},
	save: vi.fn(async (_: unknown) => null),
}));
vi.mock('$lib/account.svelte', () => ({ account: signedIn }));

const { ownCachedLthr, pullProfile } = await import('$lib/profile-sync.svelte');

/** The browser's cache, as the root layout's store holds it. */
function cache(stored: Partial<Profile>) {
	let current = parseProfile(stored);
	return {
		get current() {
			return current;
		},
		update(next: Partial<Profile>) {
			current = parseProfile({ ...current, ...next });
			return null;
		},
	};
}
type Store = Parameters<typeof pullProfile>[0];

const ANA = 'rider-ana';
const BEN = 'rider-ben';
const ben = (lthr?: number) => ({
	id: BEN,
	displayName: 'Ben',
	ftpWatts: 230,
	weightKg: 80,
	lthr,
});
const pushed = () =>
	signedIn.save.mock.calls.map(
		([body]) => (body as { lthr?: number }).lthr ?? null,
	);

beforeEach(() => {
	signedIn.save.mockClear();
	signedIn.me = ben();
});

// The laptop beside a shared trainer (#2805). Ana set LTHR 171 and signed
// out; Ben, who never set one, signed in — and the pull wrote her 171 onto
// his account, for good, before he had touched anything.
describe('pullProfile on a browser two riders share', () => {
	it("never pushes the last rider's LTHR onto an account that has none", () => {
		const profile = cache({ ownerId: ANA, lthr: 171, ftp: 260 });
		pullProfile(profile as unknown as Store);
		expect(pushed()).toEqual([]);
		// And the cache is Ben's now: his numbers, no anchor, his name on it.
		expect(profile.current).toMatchObject({ ownerId: BEN, ftp: 230, kg: 80 });
		expect(profile.current.lthr).toBeUndefined();
	});

	it('never pushes an LTHR nobody stamped — it could be anyone’s', () => {
		const profile = cache({ lthr: 171 });
		pullProfile(profile as unknown as Store);
		expect(pushed()).toEqual([]);
		expect(profile.current.lthr).toBeUndefined();
	});

	it("still pushes the account's own copy up when the account has none (#1571)", () => {
		const profile = cache({ ownerId: BEN, lthr: 171 });
		pullProfile(profile as unknown as Store);
		expect(pushed()).toEqual([171]);
		expect(profile.current.lthr).toBe(171);
	});

	it('takes the account’s LTHR over any cached one', () => {
		signedIn.me = ben(158);
		const profile = cache({ ownerId: ANA, lthr: 171 });
		pullProfile(profile as unknown as Store);
		expect(pushed()).toEqual([]);
		expect(profile.current.lthr).toBe(158);
	});

	it("drops another rider's ramp date and keeps an unstamped one", () => {
		const theirs = cache({ ownerId: ANA, ftpMeasuredAt: 1 });
		pullProfile(theirs as unknown as Store);
		expect(theirs.current.ftpMeasuredAt).toBeUndefined();

		const unstamped = cache({ ftpMeasuredAt: 1 });
		pullProfile(unstamped as unknown as Store);
		expect(unstamped.current.ftpMeasuredAt).toBe(1);
	});
});

describe('ownCachedLthr', () => {
	it("is the cached LTHR only when this account's pull put it there", () => {
		const me = ben() as Parameters<typeof ownCachedLthr>[1];
		expect(ownCachedLthr(parseProfile({ ownerId: BEN, lthr: 171 }), me)).toBe(
			171,
		);
		expect(
			ownCachedLthr(parseProfile({ ownerId: ANA, lthr: 171 }), me),
		).toBeUndefined();
		expect(ownCachedLthr(parseProfile({ lthr: 171 }), me)).toBeUndefined();
	});
});
