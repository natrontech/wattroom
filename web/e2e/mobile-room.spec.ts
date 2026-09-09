import type { Locator } from '@playwright/test';
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
		// Wait for the excess to settle at zero rather than a fixed 300 ms.
		const excessOf = () =>
			body.evaluate((el) => el.scrollWidth - el.clientWidth);
		await expect
			.poll(excessOf, { timeout: 3_000 })
			.toBe(0)
			.catch(() => {});
		const excess = await excessOf();
		if (excess > 0) wide.push(`${place || '/'} overflows by ${excess}px`);
	}
	expect(wide, 'room places wider than a 375px phone').toEqual([]);
});

/**
 * The rows the sweep above calls widest never rendered in it (#1766): a phone
 * is a spectator, so the coach's Move and Cancel never drew, and a room of
 * one has no member row but the owner's. So: a guest, the cockpit (`?full=1`
 * spends the spectator gate, #412), and the three overlays nothing at 375
 * measured — the confirm, a context menu and the session picker.
 */
test('the coach rows, the confirm, a menu and the picker fit a phone', async ({
	page,
	riders,
	rooms,
}) => {
	await signInAs(page, 'Phone Rows', '/rooms');
	const room = await rooms.open(page, `Phone Rows ${Date.now() % 100000}`);
	const guest = await riders('Phone Guest');
	await rooms.enter(guest, room);
	const planned = await page.evaluate(async (slug) => {
		const res = await fetch(`/api/rooms/${slug}/schedule`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workoutName: 'Phone Rows Session',
				workoutJson: JSON.stringify({
					name: 'Phone Rows Session',
					steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
				}),
				startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
			}),
		});
		return res.ok;
	}, room.slug);
	expect(planned, 'could not plan a session for the coach row').toBe(true);

	// An overlay is fixed, so the place column cannot absorb it: measure the
	// box itself against the viewport.
	const fits = async (what: string, overlay: Locator) => {
		await expect(overlay, what).toBeVisible();
		const box = await overlay.boundingBox();
		expect(box, `${what} has no box`).not.toBeNull();
		expect(box!.x, `${what} starts left of the screen`).toBeGreaterThanOrEqual(
			0,
		);
		expect(box!.x + box!.width, `${what} runs past 375px`).toBeLessThanOrEqual(
			375,
		);
	};
	const noOverflow = async (what: string) => {
		const body = page.getByTestId('place-body');
		await expect(body).toBeVisible();
		const excessOf = () =>
			body.evaluate((el) => el.scrollWidth - el.clientWidth);
		await expect
			.poll(excessOf, { timeout: 3_000 })
			.toBe(0)
			.catch(() => {});
		expect(await excessOf(), `${what} overflows`).toBe(0);
	};

	// The coach's row: Move and Cancel beside "I'm in".
	await page.goto(`/r/${room.slug}/sessions?full=1`);
	await expect(page.getByRole('button', { name: 'Move' })).toBeVisible();
	await noOverflow('the Sessions place with the coach row');
	// The confirm behind Cancel.
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await fits('the cancel confirm', page.getByRole('dialog'));
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	// The picker.
	await page.getByRole('button', { name: 'Plan a session' }).click();
	await fits('the session picker', page.getByRole('dialog'));
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);

	// The guest's row, and the menu behind it.
	await page.goto(`/r/${room.slug}/members?full=1`);
	const row = page
		.getByRole('listitem')
		.filter({ hasText: 'Phone Guest' })
		.first();
	await expect(row).toBeVisible();
	await noOverflow('the Members place with a guest row');
	await row.click({ button: 'right' });
	await fits('the member menu', page.getByRole('menu'));
});
