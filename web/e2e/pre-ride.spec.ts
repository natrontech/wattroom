import { expect, test, voicePath } from './crew';
import { signInAs } from './signin';

/**
 * The pre-ride and what the rider already has (#2635).
 *
 * A trainer a voice channel holds is paired as far as the rider is concerned:
 * /ride used to call it unpaired and Pair dropped its link to ask for the same
 * unit. And a new account's FTP is the 200 W nobody chose, which the pre-ride
 * showed as "your FTP" below Start while Profile and Home said it was a guess.
 */
test('the pre-ride rides the trainer the voice channel holds', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const page = await riders('Pre Ride Holder');
	await page.setViewportSize({ width: 1440, height: 900 });
	const opened = await channels.open(page, `Pre Ride ${Date.now() % 100000}`);
	await page.goto(`${voicePath(opened)}/training`);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await expect(page.getByText(/^\d+ rpm/).first()).toBeVisible({
		timeout: 15_000,
	});

	// In-app, so the channel's connection — and the trainer it holds — stays.
	await page.evaluate(() => {
		const link = document.createElement('a');
		link.href = '/ride?w=smoke-test';
		document.body.append(link);
		link.click();
	});
	await page.waitForURL(/\/ride\?w=smoke-test$/);
	const card = page.getByText('Simulated Trainer').locator('..');
	await expect(card.getByText(/\d+ W · \d+ rpm/)).toBeVisible({
		timeout: 15_000,
	});
	const start = page.getByRole('button', { name: 'Start the ride' });
	await expect(start).toBeEnabled();
	await start.click();
	await expect(page.getByTestId('ride-clock')).toBeVisible({ timeout: 15_000 });
});

test('a new account is told its FTP is a starting guess, above Start', async ({
	page,
}) => {
	await signInAs(page, 'Pre Ride Newcomer', '/ride?w=smoke-test');
	const guess = page.getByText(
		'This 200 W is where we start everyone, not a measurement.',
	);
	await expect(guess).toBeVisible({ timeout: 15_000 });
	const start = page.getByRole('button', { name: 'Start the ride' });
	const guessBox = await guess.boundingBox();
	const startBox = await start.boundingBox();
	expect(guessBox!.y, 'the guess is asked before Start').toBeLessThan(
		startBox!.y,
	);
});
