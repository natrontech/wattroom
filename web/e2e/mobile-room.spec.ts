import type { Locator } from '@playwright/test';
import { expect, test, voicePath } from './room';
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
 * that never opens or a text channel that becomes unreachable below `md` —
 * the voice channel's own chat is the lounge's, so the full-width one is its
 * text twin in the crew's column (#2447).
 */
test('a phone opens a voice channel and reaches its text channel', async ({
	page,
	rooms,
}) => {
	await signInAs(page, 'Mobile Room', '/home');
	const name = `Mobile Room ${Date.now() % 100000}`;
	const room = await rooms.open(page, name);
	await page.goto(voicePath(room));

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
	// Every room became a text and a voice channel of its name (ADR-0058).
	const text = page
		.locator(`a[href^="/crew/${room.crew}/c/"]`)
		.filter({ hasText: name });
	await expect(text).toBeVisible();
	await text.click();

	await expect(page).toHaveURL(new RegExp(`/crew/${room.crew}/c/[^/]+$`));
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
	await signInAs(page, 'Phone Places', '/home');
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
	for (const place of ['', '/chat', '/training', '/sessions', '/members']) {
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
		// One main per document, in the same sweep (#2164): the room shell
		// draws the landmark, and Settings drew a second one inside it — two
		// nested mains, which is invalid HTML and two "main" stops for a
		// screen reader. The 2026-09-10 accessibility pass looked for a
		// missing one and would not have seen this.
		const mains = await page.locator('main').count();
		if (mains !== 1) wide.push(`${place || '/'} has ${mains} main landmarks`);
	}
	expect(wide, 'room places wider than a 375px phone').toEqual([]);
});

/**
 * The rows the sweep above calls widest never rendered in it (#1766): a room of
 * one has no member row but the owner's, and the widest Sessions row is the one
 * with "Start now" on it, which is the cockpit's (`?full=1` spends the
 * spectator gate, #412 — Move and Cancel draw without it since #1767). So: a
 * guest, the cockpit, and the three overlays nothing at 375 measured — the
 * confirm, a context menu and the session picker.
 */
test('the coach rows, the confirm, a menu and the picker fit a phone', async ({
	page,
	riders,
	rooms,
}) => {
	await signInAs(page, 'Phone Rows', '/home');
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

	// The coach's row: Move and Cancel session beside "I'm in".
	await page.goto(`/r/${room.slug}/sessions?full=1`);
	await expect(page.getByRole('button', { name: 'Move…' })).toBeVisible();
	await noOverflow('the Sessions place with the coach row');

	// The confirm behind Cancel session.
	await page
		.getByRole('button', { name: 'Cancel session', exact: true })
		.click();
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

/**
 * Planning is not riding (#1767). The spectator gate used to reach past the
 * cockpit and into the calendar: a room's own OWNER, holding a phone, got no
 * plan button and an empty state reading "Your coach plans them here". What
 * still needs the riding screen is starting — so this place offers the one and
 * not the other, and says which device the other is on.
 */
test('a phone plans a session and still does not start one', async ({
	page,
	rooms,
}) => {
	await signInAs(page, 'Phone Planner', '/home');
	const { slug } = await rooms.open(
		page,
		`Phone Planner ${Date.now() % 100000}`,
	);

	// The empty state first: this is the sentence the owner used to read.
	await page.goto(`/r/${slug}/sessions`);
	await expect(
		page.getByRole('button', { name: 'Plan the first session' }),
	).toBeVisible();
	await expect(page.getByText(/your coach plans them here/i)).toHaveCount(0);

	// The picker it opens only plans on this device. Its start half hangs off
	// a PICKED workout, so pick one — asserting against the unpicked dialog
	// would pass whatever the gate did.
	await page.getByRole('button', { name: 'Plan the first session' }).click();
	const picker = page.getByRole('dialog');
	await expect(picker).toBeVisible();
	await picker.getByRole('listitem').getByRole('button').first().click();
	await expect(
		picker.getByRole('button', { name: 'Plan it', exact: true }),
	).toBeVisible();
	await expect(
		picker.getByRole('button', { name: /start it now instead/i }),
	).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);

	// A plan that is due, so "Start now" would draw on a riding screen. Not
	// here: the coach's own row is the phone's, the cockpit's is not.
	const planned = await page.evaluate(async (slug) => {
		const res = await fetch(`/api/rooms/${slug}/schedule`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workoutName: 'Phone Planner Session',
				workoutJson: JSON.stringify({
					name: 'Phone Planner Session',
					steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
				}),
				startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
			}),
		});
		return res.ok;
	}, slug);
	expect(planned, 'could not plan a session').toBe(true);

	await page.goto(`/r/${slug}/sessions`);
	await expect(page.getByRole('button', { name: 'Move…' })).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Cancel session', exact: true }),
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start now' })).toHaveCount(0);
	await expect(page.getByText('starting soon')).toBeVisible();

	// And the menu says where it went rather than hiding it (ux.md: a missing
	// precondition is a disabled control with a one-line hint).
	await page
		.getByRole('listitem')
		.filter({ hasText: 'Phone Planner Session' })
		.first()
		.click({ button: 'right' });
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	await expect(
		menu.getByText('start it from the screen you ride on'),
	).toBeVisible();
});
