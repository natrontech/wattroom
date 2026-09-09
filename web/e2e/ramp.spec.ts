import { expect, test } from '@playwright/test';
import { signInTo } from './signin';

/**
 * The ramp had no flow of its own (#1797): "Test again" was a link to the page
 * you were already on, which a same-route navigation leaves exactly as it
 * was, so the page's primary button did nothing. This starts a ramp on the
 * simulator, ends it in the warm-up, and expects the button to hand back a
 * fresh page with the trainer grid.
 */
test('a ramp ended early offers a test again that actually restarts', async ({
	page,
}) => {
	await signInTo(page, '/ramp');
	await expect(page.getByRole('heading', { name: 'Ramp test' })).toBeVisible();
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	const trainerCard = page.getByText('Simulated Trainer').locator('..');
	await expect(trainerCard.getByText(/\d+ W · \d+ rpm/)).toBeVisible({
		timeout: 15_000,
	});
	const start = page.getByRole('button', { name: 'Start ramp test' });
	await expect(start).toBeEnabled();
	await start.click();

	// The test is running: the step header and the way out.
	const done = page.getByRole('button', { name: "I'm done" });
	await expect(done).toBeVisible({ timeout: 15_000 });
	await done.click();

	// Ended in the warm-up: nothing to measure, and a real way to go again.
	await expect(
		page.getByRole('heading', { name: 'Not enough to measure' }),
	).toBeVisible();
	await page.getByRole('button', { name: 'Test again' }).click();
	await expect(
		page.getByRole('button', { name: 'Ride simulated' }),
	).toBeVisible();
	await expect(page.getByRole('button', { name: "I'm done" })).toHaveCount(0);
});
