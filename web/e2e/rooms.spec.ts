import { expect, test } from '@playwright/test';
import { signInTo } from './signin';

/**
 * The golden onboarding path (#122): a fresh account creates its first room
 * through the UI. This exact flow shipped hard-broken once — the create form
 * only rendered when the room list was non-empty, so the empty state's CTAs
 * focused inputs that did not exist.
 */
test('a fresh user creates their first room through the UI', async ({
	page,
}) => {
	await signInTo(page, '/rooms');

	// The create form must exist whether the list is empty (fresh CI user) or
	// not (a local dev account with rooms) — that invariant IS the bug.
	const name = `Smoke Test Crew ${Date.now() % 100000}`;
	await page.locator('#open-room-name').fill(name);
	await page.getByRole('button', { name: 'Open room' }).click();

	// Creation lands inside the room, already a member.
	await expect(page.getByRole('heading', { name })).toBeVisible({
		timeout: 15_000,
	});

	// Leave the world as found: the owner deletes it via the API.
	const slug = page.url().split('/r/')[1];
	const status = await page.evaluate(
		(roomSlug) =>
			fetch(`/api/rooms/${roomSlug}`, { method: 'DELETE' }).then(
				(res) => res.status,
			),
		slug,
	);
	expect(status).toBe(204);
});
