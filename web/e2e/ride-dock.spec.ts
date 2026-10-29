import { expect, test } from './crew';
import { follow } from './follow';

/**
 * The ride dock (ADR-0093 point 5, #4259): while a ride runs and no riding
 * screen draws it, the sidebar carries it, with its time, its watts, Open
 * and End ride. With no ride, or on its riding screen, there is none. On a
 * phone the top bar carries its short form, one tap back to the ride.
 */
test('the sidebar docks a ride running off its screen, and only then', async ({
	riders,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(3 * 60_000);

	const page = await riders('Ride Dock Rider');
	const dock = page.getByTestId('ride-dock');
	const short = page.getByTestId('ride-dock-short');

	await page.goto('/home');
	await expect(page.getByTestId('page-body')).toBeVisible();
	await expect(dock, 'a dock with no ride').toHaveCount(0);

	await page.goto('/ride?w=smoke-test');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await expect(
		page
			.getByText('Simulated Trainer')
			.locator('..')
			.getByText(/\d+ W · \d+ rpm/),
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	const end = page.getByRole('button', { name: 'End ride' });
	await expect(end).toBeVisible({ timeout: 15_000 });
	await expect(dock, 'a dock beside its own riding screen').toHaveCount(0);

	await follow(page, '/home');
	await expect(dock, 'no dock for a ride off its screen').toBeVisible();
	await expect(dock.getByText('Riding alone')).toBeVisible();
	await expect(dock.getByTestId('ride-dock-watts')).toHaveText(/^\d+$/);
	await expect(dock.getByTestId('ride-dock-time')).toHaveText(/^\d+:\d\d$/);

	// A phone: the top bar's short form opens the ride in one 44 px tap, and
	// the page body still never scrolls sideways (ux.md).
	await page.setViewportSize({ width: 375, height: 812 });
	await expect(short).toBeVisible();
	expect((await short.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
	const sideways = await page
		.getByTestId('page-body')
		.evaluate((body) => body.scrollWidth - body.clientWidth);
	expect(sideways, 'the page body scrolls sideways').toBeLessThanOrEqual(0);
	await page.getByRole('button', { name: 'open navigation' }).click();
	await expect(dock, 'the drawer lost the dock').toBeVisible();
	await page.keyboard.press('Escape');
	await short.click();
	await expect(page).toHaveURL(/\/ride$/);
	await expect(end).toBeVisible();
	await expect(short).toHaveCount(0);
	await page.setViewportSize({ width: 1280, height: 800 });

	// Open returns to the riding screen; End ride is the riding screen's own,
	// and lands on its closing card there.
	await follow(page, '/home');
	await dock.getByRole('link', { name: 'Open' }).click();
	await expect(page).toHaveURL(/\/ride$/);
	await expect(end).toBeVisible();
	await expect(dock).toHaveCount(0);

	await follow(page, '/home');
	await dock.getByRole('button', { name: 'End ride' }).click();
	await page.getByRole('button', { name: 'End the ride' }).click();
	await expect(page).toHaveURL(/\/ride$/);
	await expect(page.getByTestId('closing-card')).toBeVisible({
		timeout: 15_000,
	});
	await follow(page, '/home');
	await expect(dock, 'a dock for a ride that ended').toHaveCount(0);
});
