import { expect, test, type Page } from '@playwright/test';
import { signInTo } from './signin';

/**
 * Cancelling the count-in hands the trainer back (#2615). Start took it out
 * of the pre-ride's slot and Cancel dropped the session holding it, so the
 * pre-ride came back showing no trainer and Start greyed — over a GATT link
 * still open, which a second pair then doubled (#1716).
 */
async function pairSimulated(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	const trainerCard = page.getByText('Simulated Trainer').locator('..');
	await expect(trainerCard.getByText(/\d+ W · \d+ rpm/)).toBeVisible({
		timeout: 15_000,
	});
}

test('a cancelled count-in on /ride leaves the trainer paired', async ({
	page,
}) => {
	await signInTo(page, '/ride?w=smoke-test');
	await pairSimulated(page);
	const start = page.getByRole('button', { name: 'Start the ride' });
	await start.click();
	await page.getByRole('button', { name: 'Cancel' }).click({ timeout: 15_000 });

	await expect(start).toBeEnabled();
	await expect(
		page
			.getByText('Simulated Trainer')
			.locator('..')
			.getByText(/\d+ W · \d+ rpm/),
	).toBeVisible({ timeout: 15_000 });
});

test('a cancelled count-in on /ramp leaves the trainer paired', async ({
	page,
}) => {
	await signInTo(page, '/ramp');
	await pairSimulated(page);
	const start = page.getByRole('button', { name: 'Start ramp test' });
	await start.click();
	await page.getByRole('button', { name: 'Cancel' }).click({ timeout: 15_000 });

	await expect(start).toBeEnabled();
});
