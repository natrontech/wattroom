import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * The FTP prompt follows the ride that earned it (#2626). The server suggests
 * an FTP on /api/me once a ride outgrows the setting, and nothing re-read that
 * after a save: a rider going from the summary to Rides saw no prompt until a
 * reload. The prompt also sat inside the charts' branch, so a failed
 * progression read hid it too. Here the suggestion appears after Home has
 * read the account, and the charts refuse.
 */
test('Rides offers a suggested FTP it learned after Home, even when its charts fail', async ({
	page,
}) => {
	await signInAs(page, 'Ftp Prompt Rider', '/home');
	let suggesting = false;
	await page.route('**/api/me', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		const response = await route.fetch();
		const me = (await response.json()) as { ftpWatts: number };
		await route.fulfill({
			response,
			json: suggesting
				? { ...me, suggestedFtp: me.ftpWatts + 20, best20m: me.ftpWatts + 21 }
				: me,
		});
	});
	await page.route('**/api/progression', (route) =>
		route.fulfill({
			status: 500,
			json: { error: 'internal_error', message: 'The charts are unavailable.' },
		}),
	);

	// A ride elsewhere raised the curve since Home read the account.
	suggesting = true;
	await page.locator('a[href="/history"]').first().click();
	await page.waitForURL('/history');
	await expect(page.getByText('The charts are unavailable.')).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.getByText('Your FTP looks low')).toBeVisible();
	// The account is re-read from several places, and one still on its way
	// as the page closes must not fail the test from inside the route.
	await page.unrouteAll({ behavior: 'ignoreErrors' });
});
