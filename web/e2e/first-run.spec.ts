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
	const first = page.getByRole('link', { name: /Ride your first road/ });
	await expect(first).toBeVisible();
	await first.click();
	await expect(page).toHaveURL(/\/ride\?road=intro$/);
});

const MUTE = () =>
	localStorage.setItem(
		'wattroom.mixer.v1',
		JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
	);

/**
 * Step 3 (#3218): the card leads onto the built-in intro road, and a fresh
 * account rides it on the simulated trainer, no route of its own needed.
 */
test('the first-run card rides the intro road on the simulated trainer', async ({
	page,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	await page.addInitScript(MUTE);
	await signInAs(page, 'Intro Road Rider', '/home');
	await page.getByRole('link', { name: /Ride your first road/ }).click();
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	await expect(
		page.getByRole('heading', { name: 'Your first road' }),
	).toBeVisible();
	await expect(page.getByTestId('bike-computer')).toBeVisible({
		timeout: 15_000,
	});
});

/**
 * The first world ride shows three coach marks (#3218) and, once dismissed,
 * never again on this device.
 */
test('the first world ride shows its three marks once @world', async ({
	page,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.addInitScript(MUTE);
	// The world is in slot 2 behind this flag (#3031).
	await page.addInitScript(() =>
		localStorage.setItem('wattroom.world-slot.v1', '1'),
	);
	await signInAs(page, 'Coach Mark Rider', '/ride?w=smoke-test&road=intro');
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	const mark = page.getByTestId('coach-mark');
	await expect(mark).toContainText('Your zone', { timeout: 20_000 });
	await mark.getByRole('button', { name: 'Next' }).click();
	await expect(mark).toContainText('The road ahead');
	await mark.getByRole('button', { name: 'Skip' }).click();
	await expect(mark).toHaveCount(0);
	// Kept for the device: the next world ride opens without them.
	expect(
		await page.evaluate(() => localStorage.getItem('wattroom.coach.road.v1')),
	).toBe('1');
	// "How to read the road" in slot 1 brings them back.
	await page.getByRole('button', { name: 'How to read the road' }).click();
	await expect(mark).toContainText('Your zone');
});

/**
 * The step above it (#1484): an account is created holding 200 W and 75 kg
 * that nobody chose, and every FTP-relative target scales from them. The ask
 * is answered in place and the answer retires the step — and until it is
 * answered, the FTP tile says the number is a guess and w/kg is withheld
 * rather than dividing one guess by another.
 */
test('a new account is asked for its FTP and weight, and answering retires the step', async ({
	page,
}) => {
	test.skip(
		!!process.env.WATTROOM_SYNTHETIC_TOKEN,
		'this needs an account that has never answered, and must not purge the production synthetic',
	);
	// A source only ever moves away from "nobody chose it" — by design, so a
	// rider cannot talk their way back into being unasked. This spec's rider
	// is stable and reused, so the run that answered leaves nothing to ask
	// the next time: purge the account through the rider's own route and come
	// back through the same door, which mints it afresh.
	await signInAs(page, 'Unasked Rider', '/home');
	expect((await page.request.delete('/api/me')).ok()).toBeTruthy();
	await signInAs(page, 'Unasked Rider', '/home');

	const ask = page.getByText('Set your FTP and weight');
	await expect(ask).toBeVisible();
	// Above "Ride your first road", because it is above it in consequence.
	const labels = await page
		.getByText(/Set your FTP and weight|Ride your first road/)
		.allInnerTexts();
	expect(labels[0]).toContain('Set your FTP and weight');

	const ftp = page.getByRole('spinbutton', { name: /FTP/ });
	const kg = page.getByRole('spinbutton', { name: /weight/ });
	await expect(ftp).toHaveValue('200');
	await expect(kg).toHaveValue('75');

	// Nothing measured, so nothing reads as measured.
	await expect(
		page.getByText(/a starting guess, not a measurement/),
	).toBeVisible();
	await expect(page.getByText(/w\/kg/)).toHaveCount(0);

	await ftp.fill('247');
	await kg.fill('71');
	await page.getByRole('button', { name: 'Save' }).click();

	// The step retires itself, and the tile stops apologising for the number.
	await expect(page.getByRole('spinbutton', { name: /FTP/ })).toHaveCount(0);
	await expect(
		page.getByText(/a starting guess, not a measurement/),
	).toHaveCount(0);
	await expect(page.getByText('3.5 w/kg')).toBeVisible();
});
