import { expect, test } from './room';
import { signInAs } from './signin';

// The standard, not the project's Pixel 5 (#1624): 393 px hid a Lounge that
// scrolled sideways at 375. And a spectator — the phone project ships a
// Web Bluetooth API, which is the one thing a real phone lacks, so nothing
// here ever exercised #412's capability gate.
test.use({ viewport: { width: 375, height: 812 } });
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(Navigator.prototype, 'bluetooth', {
			get: () => undefined,
			configurable: true,
		});
	});
});

/**
 * A phone runs the room shell, not the retired spectator redirect (#412).
 * Keep one small-viewport walk here: the desktop suite cannot notice a drawer
 * that never opens or a Chat place that becomes unreachable below `md`.
 */
test('a phone opens a room lounge and reaches its chat place', async ({
	page,
	rooms,
}) => {
	await signInAs(page, 'Mobile Room', '/rooms');
	const name = `Mobile Room ${Date.now() % 100000}`;
	const { slug } = await rooms.open(page, name);

	await expect(page).toHaveURL(new RegExp(`/r/${slug}$`));
	await expect(page.getByRole('heading', { name })).toBeVisible();
	// A spectator, even as the room's owner: nothing that needs a trainer
	// or starts a session is offered (#412, #1624).
	await expect(
		page.getByRole('button', { name: /start a session/i }),
	).toHaveCount(0);
	await expect(page.getByRole('link', { name: /join the ride/i })).toHaveCount(
		0,
	);

	await page.getByRole('button', { name: 'open navigation' }).click();
	const chat = page.locator(`a[href="/r/${slug}/chat"]`).first();
	await expect(chat).toBeVisible();
	await chat.click();

	await expect(page).toHaveURL(new RegExp(`/r/${slug}/chat$`));
	await expect(page.getByTestId('thread-log')).toBeVisible();
});

/**
 * No place in a room scrolls sideways on a phone either (#1376). The app-wide
 * spec exempts the room, and the room holds the widest rows in the app — a
 * planned session's row of three buttons, a member's row beside two. Measured
 * on the shell's own place column, for the reason phone-width.spec.ts gives:
 * the document absorbs the overflow and stays exactly 375 wide.
 */
test('no place in a room scrolls sideways on a phone', async ({
	page,
	rooms,
}) => {
	await signInAs(page, 'Phone Places', '/rooms');
	const { slug } = await rooms.open(
		page,
		`Phone Places ${Date.now() % 100000}`,
	);

	// The Sessions row is the widest thing here, and only exists once a
	// session is planned — without one the place asserts nothing.
	const planned = await page.evaluate(async (slug) => {
		const res = await fetch(`/api/rooms/${slug}/schedule`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workoutName: 'Phone Width Session',
				workoutJson: JSON.stringify({
					name: 'Phone Width Session',
					steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
				}),
				startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
			}),
		});
		return res.ok;
	}, slug);
	expect(planned, 'could not plan a session for the Sessions row').toBe(true);

	const wide: string[] = [];
	for (const place of [
		'',
		'/chat',
		'/training',
		'/sessions',
		'/members',
		'/settings',
	]) {
		await page.goto(`/r/${slug}${place}`);
		const body = page.getByTestId('place-body');
		await expect(body).toBeVisible();
		await page.waitForTimeout(300);
		const excess = await body.evaluate((el) => el.scrollWidth - el.clientWidth);
		if (excess > 0) wide.push(`${place || '/'} overflows by ${excess}px`);
	}
	expect(wide, 'room places wider than a 375px phone').toEqual([]);
});
