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
