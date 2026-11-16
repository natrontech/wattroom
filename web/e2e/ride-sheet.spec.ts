import { expect, test } from './crew';

/**
 * The ride sheet (#4616): in a call, every way into a ride asks with whom
 * and what first. Here a rider in their crew's voice channel presses the
 * NowBar's Ride, starts a session Each on their own and is told the road
 * spreads them out, takes One road, one bunch instead and lands on the
 * session picker's Roads; then a workout's Ride, still in the call, opens the
 * sheet with that workout chosen and rides it alone.
 */
test('in a call, Ride asks with whom and what before it rides', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const page = await riders('Ride Sheet Rider');
	await channels.open(page, `Ride Sheet ${Date.now() % 100000}`);

	await page.getByRole('button', { name: 'Ride', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'Ride' });
	await expect(sheet.getByRole('button', { name: /^Alone/ })).toBeVisible();

	// Nobody rides here yet: the channel is started, not joined.
	await sheet.getByRole('button', { name: /^Start a session/ }).click();
	await sheet.getByRole('button', { name: /^Each on their own/ }).click();
	await expect(sheet.getByText(/the channel spreads out/)).toBeVisible();
	await sheet
		.getByRole('button', { name: 'One road, one bunch', exact: true })
		.click();
	await sheet.getByRole('button', { name: 'Choose it' }).click();
	await expect(sheet).toBeHidden();
	await expect(
		page.getByRole('heading', { name: 'Start a session' }),
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Roads', pressed: true }),
	).toBeVisible();
	await page.keyboard.press('Escape');

	// A workout's Ride, still in the call: the sheet, with it chosen.
	// In-app, so the call stays: a reload would leave it. The sidebar is
	// the crew's here; your own row at its foot is the way to You.
	await page.getByTitle(/your own Home/).click();
	await page
		.getByRole('link', { name: 'Workouts', exact: true })
		.first()
		.click();
	await expect(page).toHaveURL(/\/workouts$/);
	const card = page.getByRole('listitem').filter({ hasText: 'Recovery Spin' });
	await card.getByRole('link', { name: 'Ride', exact: true }).first().click();
	await expect(sheet).toBeVisible();
	await expect(
		sheet.getByRole('button', { name: 'Recovery Spin', pressed: true }),
	).toBeVisible();
	await sheet.getByRole('button', { name: /^Alone/ }).click();
	await sheet.getByRole('button', { name: 'Ride', exact: true }).click();
	await expect(page).toHaveURL(/\/ride\?w=/);
});
