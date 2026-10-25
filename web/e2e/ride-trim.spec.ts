import { expect, test } from '@playwright/test';
import { signInTo } from './signin';

/**
 * The bias trim on a desk's flat ride (#4155). The flat numbers dock gives the
 * bike computer `display: contents`, which let its full-panel page button
 * cover the whole dock: a tap on + turned the page and trimmed nothing. A
 * pointer click is the test, since only real hit-testing sees the cover.
 */
test.use({ viewport: { width: 1440, height: 900 } });

test('a tap on the trim trims, and leaves the page where it was', async ({
	page,
}) => {
	await signInTo(page, '/ride?w=smoke-test');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await expect(
		page
			.getByText('Simulated Trainer')
			.locator('..')
			.getByText(/\d+ W · \d+ rpm/),
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();

	const computer = page.getByTestId('bike-computer');
	await expect(computer.getByText('rpm', { exact: true })).toBeVisible({
		timeout: 20_000,
	});
	const before = await computer.getAttribute('data-page');

	await page
		.getByRole('button', { name: 'raise the target by one percent' })
		.click({ timeout: 5_000 });

	await expect(page.getByText('101%', { exact: true })).toBeVisible();
	await expect(computer).toHaveAttribute('data-page', before!);
});
