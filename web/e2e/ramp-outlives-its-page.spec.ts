import { expect, test } from '@playwright/test';
import { follow } from './follow';
import { signInTo } from './signin';

/**
 * The ramp test is the rider's ride too (ADR-0093, #4259): it runs on while
 * the rider reads Home, nothing asks to stop it on the way out, and /ride
 * and /ramp both draw it again, still under way.
 */
test('a ramp under way runs on off its page, and /ride and /ramp draw it again', async ({
	page,
}) => {
	await signInTo(page, '/ramp');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await expect(
		page
			.getByText('Simulated Trainer')
			.locator('..')
			.getByText(/\d+ W · \d+ rpm/),
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start ramp test' }).click();
	const done = page.getByRole('button', { name: "I'm done" });
	await expect(done).toBeVisible({ timeout: 15_000 });

	await follow(page, '/home');
	await expect(done).toHaveCount(0);
	await follow(page, '/ride');
	await expect(done, 'the ramp ended when its page closed').toBeVisible();
	await follow(page, '/ramp');
	await expect(done).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Start ramp test' }),
		'/ramp offered a second ride',
	).toHaveCount(0);

	await done.click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Stop the test' })
		.click();
	await expect(
		page.getByRole('heading', { name: 'Not enough to measure' }),
	).toBeVisible();
});
