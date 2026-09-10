import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * The first-run card (#1333, #1857): a rider who has never ridden sees what
 * to do first on Home, and the step is a link to where it is done. This
 * rider never rides, so the card is there every run — and the account that
 * needs it most is exactly one with no ride and no crew to speak of, which
 * is the account #1857 found never saw it.
 */
test('a rider who has never ridden is shown the first step on Home', async ({
	page,
}) => {
	await signInAs(page, 'First Run Rider', '/home');
	await expect(page.getByText(/getting set up/)).toBeVisible();
	const first = page.getByRole('link', { name: /Take your first ride/ });
	await expect(first).toBeVisible();
	await first.click();
	await expect(page).toHaveURL(/\/settings\/equipment$/);
});
