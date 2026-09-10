import { expect, test } from './room';
import { signInAs } from './signin';

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
	await signInAs(page, 'Smoke Crew Owner', '/home');

	// This rider owns nothing when the run starts — the fixture takes its room
	// back every time — so the empty list is what gets exercised, which is the
	// state the bug lived in. Before #594 that depended on whatever rooms the
	// shared dev account happened to hold. Opening through `rooms` asserts
	// creation landed inside the room, already a member, and hands the room's
	// lifetime to the fixture.
	await rooms.open(page, `Smoke Test Crew ${Date.now() % 100000}`);
});

/**
 * /rooms is retired (ADR-0020): the sidebar is the room list. The stub
 * stays so shared links still land — on Home's door, not on a 404.
 */
test('the retired /rooms link lands on the door', async ({ page }) => {
	await signInAs(page, 'Smoke Crew Owner', '/rooms');
	await expect(page).toHaveURL(/\/home#rooms$/);
	await expect(page.locator('#open-room-name')).toBeVisible();
});
