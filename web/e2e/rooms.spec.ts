import { test } from './room';
import { signInTo } from './signin';

/**
 * The golden onboarding path (#122): a fresh account creates its first room
 * through the UI. This exact flow shipped hard-broken once — the create form
 * only rendered when the room list was non-empty, so the empty state's CTAs
 * focused inputs that did not exist.
 */
test('a fresh user creates their first room through the UI', async ({
	page,
	rooms,
}) => {
	await signInTo(page, '/rooms');

	// The create form must exist whether the list is empty (fresh CI user) or
	// not (a local dev account with rooms) — that invariant IS the bug. Opening
	// through `rooms` asserts creation landed inside the room, already a
	// member, and hands the room's lifetime to the fixture (#594).
	await rooms.open(page, `Smoke Test Crew ${Date.now() % 100000}`);
});
