import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './signin';

/**
 * Where a rider goes looking for a setting is part of the setting (#1860).
 *
 * Three things were filed under headings nobody would open them under: the two
 * sprint settings — statements about a drivetrain and a trainer — sat on
 * Profile, "who you are and the numbers every ride scales from"; the calendar
 * link, a bearer secret, sat on Home; and Sign out was reachable only from
 * Settings › Your data, between "Export everything" and "Delete account".
 *
 * Each section of the tree has its own address, so each of these is pinned by
 * the route it must resolve at — and by its absence from the route it left,
 * which is the half that catches a move made by copy rather than by cut.
 */

/** The stored profile, which is what "it saved itself" actually means. */
function storedGrade(page: Page): Promise<number | null> {
	return page.evaluate(() => {
		const raw = localStorage.getItem('wattroom.profile.v1');
		return raw
			? ((JSON.parse(raw) as { sprintGrade?: number }).sprintGrade ?? null)
			: null;
	});
}

test('the sprint settings are on Equipment, with the trainer, not on Profile', async ({
	page,
}) => {
	await signInAs(page, 'Settings Homes', '/settings/equipment');

	// docs/SPEC.md's word for the thing being configured: a sprint moment
	// flips the trainer ERG→slope, which is exactly what these two decide.
	await expect(
		page.getByRole('heading', { name: 'Sprint moments' }),
	).toBeVisible();
	await expect(
		page.getByRole('checkbox', { name: /Sprints stay in ERG/ }),
	).toBeVisible();

	// The grade is one number behind that checkbox, so it is folded (ux.md's
	// 95% rule) — reachable, but not in the way of the riders who never touch it.
	const grade = page.getByRole('spinbutton', { name: /sprint grade/ });
	await expect(grade).toBeHidden();
	await page.getByText('Advanced', { exact: true }).click();
	await expect(grade).toBeVisible();

	// And it saves itself: there is no other field on this page to press a Save
	// for, and a number a rider types and walks away from has to have taken.
	await grade.fill('9');
	await grade.blur();
	await expect.poll(() => storedGrade(page)).toBe(9);

	// There is no "no grade": an empty box is refused with the range said, and
	// the rider's own number comes back — never stored as nothing and read back
	// later as the 5 % default (errors.md).
	await grade.fill('');
	await grade.blur();
	await expect(
		page.getByText(/Sprint grade has to be between 1 and 15/),
	).toBeVisible();
	await expect(grade).toHaveValue('9');
	expect(await storedGrade(page)).toBe(9);

	// Profile no longer carries either of them.
	await page.goto('/settings/profile');
	await expect(page.getByText(/Sprints stay in ERG/)).toHaveCount(0);
	await expect(
		page.getByRole('spinbutton', { name: /sprint grade/ }),
	).toHaveCount(0);
});

test('the calendar link is under Your data, and Home points at it', async ({
	page,
}) => {
	await signInAs(page, 'Settings Homes', '/settings/data');

	await expect(
		page.getByRole('heading', { name: 'Calendar link' }),
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: /Copy calendar link/ }),
	).toBeVisible();
	// The warning travels with the link (ADR-0021): it is a bearer URL.
	await expect(page.getByText(/carries a private key/)).toBeVisible();

	// Home's offer renders only once there is a room to plan a session in, so
	// without one this asserts nothing. This rider is stable and reused, so a
	// room it already owns is the room — never a second one against the cap.
	const hasRoom = await page.evaluate(async () => {
		const read = async () =>
			(
				(await (await fetch('/api/rooms')).json()) as {
					rooms: { slug?: string }[];
				}
			).rooms.length > 0;
		if (await read()) return true;
		await fetch('/api/rooms', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'Settings Homes Room' }),
		});
		return read();
	});
	expect(hasRoom, 'a room, so Home offers the feed at all').toBe(true);

	// Under the list it mirrors, where a rider is already looking at their
	// sessions (ADR-0021: this is the feed the UI offers first).
	await page.goto('/home');
	const pointer = page.getByRole('link', { name: /Get your calendar link/ });
	await expect(pointer).toBeVisible();
	// A pointer, not a second copy: the bearer URL is not handed out here.
	await expect(
		page.getByRole('button', { name: /Copy calendar link/ }),
	).toHaveCount(0);
	await pointer.click();
	await expect(page).toHaveURL(/\/settings\/data$/);
});

test('signing out is on the you-menu, where a rider reaches for it', async ({
	page,
}) => {
	await signInAs(page, 'Settings Homes', '/home');

	// The you-panel at the foot of the sidebar is the object that is you on
	// every screen, and right-click is what opens its menu (ux.md). Exactly
	// this title: Home's own trophies card is also a link to /u/me, titled
	// "Your rider page: medals, …".
	await page
		.getByTitle('your rider page', { exact: true })
		.click({ button: 'right' });
	const out = page.getByRole('menuitem', { name: 'Sign out' });
	await expect(out).toBeVisible();
	await out.click();

	// The shell sends a signed-out session to the gate itself, so the menu
	// entry needs nowhere to navigate to.
	await expect(page).toHaveURL(/\/login/);
});

test("a refused profile field says so under the field, and nothing says 'Saved.'", async ({
	page,
}) => {
	await signInAs(page, 'Profile Errors', '/settings/profile');

	// The server names the field it refused (`WriteFieldError`), and the form
	// drew that for the display name alone — so a rejected FTP, weight, LTHR
	// or address appeared only in the banner at the top, away from the box to
	// fix (#2166, errors.md: "field-level → inline under the field").
	const ftpField = page.locator('label').filter({ hasText: 'FTP (W)' });
	await ftpField.getByRole('spinbutton').fill('900');
	await page.getByRole('button', { name: 'Save' }).click();

	await expect(ftpField.getByText(/FTP has to be between/)).toBeVisible();
	await expect(ftpField.getByRole('spinbutton')).toHaveAttribute(
		'aria-invalid',
		'true',
	);
	// And the refusal is the whole answer: the status line beside Save used to
	// read "Saved." over a form that had saved nothing.
	await expect(page.getByText('Saved.')).toHaveCount(0);

	// An emptied name is refused too. It used to be swallowed — the form sent
	// the stored name in its place, said "Saved." and refilled the box.
	await ftpField.getByRole('spinbutton').fill('200');
	const nameField = page.locator('label').filter({ hasText: 'display name' });
	await nameField.getByRole('textbox').fill('');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(nameField.getByText(/1-60 characters/)).toBeVisible();
	await expect(nameField.getByRole('textbox')).toHaveValue('');
});

test('an account refresh does not overwrite what the rider is typing', async ({
	page,
}) => {
	await signInAs(page, 'Profile Dirty', '/settings/profile');
	const ftp = page
		.locator('label')
		.filter({ hasText: 'FTP (W)' })
		.getByRole('spinbutton');
	await ftp.fill('275');

	// A picture upload replaces `account.me`, and the form used to re-fill
	// itself from it — so a typed FTP went back to the server's with nothing
	// said (#2165). So does a provider disconnect, and a save from any other
	// panel; this is the cheapest of the three to drive.
	await page.setInputFiles('input[type=file]', {
		name: 'face.png',
		mimeType: 'image/png',
		// A 1×1 PNG: the smallest thing the upload path accepts.
		buffer: Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			'base64',
		),
	});
	await expect(page.getByText('Picture saved.')).toBeVisible();

	await expect(ftp).toHaveValue('275');
});

test('a switch that saves itself goes back when the save is refused', async ({
	page,
}) => {
	// The account as the switch needs it — mail configured, an address
	// confirmed — and a server that refuses the save (#2181).
	await page.route('**/api/me', async (route) => {
		if (route.request().method() !== 'GET') {
			return route.fulfill({
				status: 400,
				json: {
					error: 'validation_error',
					message: 'That could not be saved.',
				},
			});
		}
		const res = await route.fetch();
		const me = await res.json();
		return route.fulfill({
			json: {
				...me,
				mailAvailable: true,
				emailVerified: '2026-09-01T00:00:00Z',
				notifyPlanned: false,
			},
		});
	});
	await signInAs(page, 'Notify Refused', '/settings/notifications');

	const box = page.getByRole('checkbox', { name: /Email me about sessions/ });
	await expect(box).toBeVisible({ timeout: 15_000 });
	await expect(box).not.toBeChecked();
	// A plain click, not check(): check() verifies the box ENDED UP ticked,
	// and the whole point here is that it does not.
	await box.click();

	// Nothing was saved, so the tick cannot stay: it said "on" over a mail
	// that will never come.
	await expect(box).not.toBeChecked();
	await expect(page.getByText('That could not be saved.')).toBeVisible();
});
