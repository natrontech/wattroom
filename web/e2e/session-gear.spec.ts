import { expect, test, voicePath } from './crew';

/**
 * Starting a session asks for the trainer first (#2594), as /ride does: the
 * picker carries the pairing card while nothing is paired, and Start says it
 * starts without one until something is.
 */
test('the session picker asks for a trainer before Start', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders('Gear First Rider');
	await a.setViewportSize({ width: 1440, height: 900 });
	const opened = await channels.open(a, `Gear First ${Date.now() % 100000}`);

	// From the Lounge, with nothing paired.
	await a.goto(voicePath(opened));
	await a
		.getByRole('button', { name: 'Start a session' })
		.click({ timeout: 15_000 });
	const picker = a.getByRole('dialog', { name: 'Start a session' });
	await picker
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await picker
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();

	await expect(picker.getByText('Pair your trainer first')).toBeVisible();
	await expect(
		picker.getByRole('button', { name: 'Start without a trainer' }),
	).toBeVisible();

	// Paired from inside the picker, the ask goes and Start is the ride's.
	await picker.getByRole('button', { name: 'Ride simulated' }).click();
	await expect(
		picker.getByRole('button', { name: 'Start Recovery Spin' }),
	).toBeVisible({ timeout: 15_000 });
	await expect(picker.getByText('Pair your trainer first')).toHaveCount(0);
});
