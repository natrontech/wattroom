import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * The public pages are prerendered (ADR-0061): the words are in the HTML the
 * server sends, so a reader that runs no script — a search or AI crawler, a
 * link preview — gets the page and not a boot frame.
 */
test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('the landing reads whole', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			/Train together/i,
		);
		await expect(page.getByText('Opening WattRoom…')).toBeHidden();
		await expect(
			page.getByRole('link', { name: 'Start your crew' }),
		).toBeVisible();
	});
});

/**
 * A path no route answers draws the error page. The shell's layout used to
 * be what cleared app.html's boot frame, and an unknown path renders outside
 * it, so "Opening WattRoom…" sat there for good.
 */
test('an unknown path says so instead of holding the boot frame', async ({
	page,
}) => {
	await page.goto('/no-such-page');
	await expect(page.getByText(/there's no page here/)).toBeVisible();
	await expect(page.getByText('Opening WattRoom…')).toBeHidden();
});

/** A signed-in "/" is the rider's place, not the pitch. */
test('a rider opening the landing is taken into the app', async ({ page }) => {
	await signInAs(page, 'Landing Rider', '/home');
	await page.goto('/');
	await expect(page).not.toHaveURL(/\/(enter)?$/);
	await expect(
		page.getByRole('link', { name: 'Start your crew' }),
	).toBeHidden();
});
