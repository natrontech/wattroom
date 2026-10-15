import { expect, test } from './crew';
import { fixtureRoad } from './design/seed';
import { signInAs } from './signin';

/**
 * The figure card (ADR-0073, #3342): once before a rider's first road ride,
 * as easy to skip as to save, and gone for good after either.
 */
test('Skip answers the card for good', async ({ page }) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	await signInAs(page, 'Unasked', '/');
	const road = await fixtureRoad(page, 'rolling');
	await page.goto(`/ride?road=${road}`);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.first()
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	const card = page.getByTestId('figure-card');
	await expect(card).toBeVisible();
	await card.getByRole('button', { name: 'Skip' }).click();
	await expect(card).toBeHidden();

	await page.goto(`/ride?road=${road}`);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.first()
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	await expect(page.getByRole('button', { name: 'Start the ride' })).toBeHidden(
		{
			timeout: 15_000,
		},
	);
	await expect(card).toBeHidden();
});
