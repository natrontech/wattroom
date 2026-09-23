import { expect, test } from './crew';
import { signInAs } from './signin';

/**
 * Starting WattRoom opens the crew you were in (#2576). A signed-in "/" went
 * Home, and since ADR-0058 made Home the You mode every start opened in You —
 * the main crew (#2144) and this device's last crew both ignored, with a page
 * that rendered fine, just the wrong one. This rider names no main crew, so
 * the device's memory is what decides.
 */
test('a start opens the crew you were last in, and Home once it is gone', async ({
	page,
	channels,
}) => {
	await signInAs(page, 'Crew Opener', '/home');
	const opened = await channels.open(
		page,
		`Crew Opener ${Date.now() % 100000}`,
	);
	await page.goto(`/crew/${opened.crew}/members`);
	const nav = page.locator('nav[aria-label="crews and channels"]');
	await expect(nav.locator('[aria-current="page"]')).toHaveText(/Members/);

	await page.goto('/');
	await expect(page).toHaveURL(new RegExp(`/crew/${opened.crew}$`));

	// A crew this device remembers that the rider is no longer in: Home, not
	// a crew page saying it is not there.
	await page.evaluate(() => localStorage.setItem('wattroom.crew.v1', 'gone'));
	await page.goto('/');
	await expect(page).toHaveURL(/\/home$/);
});
