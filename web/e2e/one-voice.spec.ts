import { devices } from '@playwright/test';
import { expect, test } from './crew';
import { signInAs } from './signin';

/**
 * One rider, one voice (ADR-0089, #4164): the desk is in voice, the same
 * rider's phone opens the channel and asks to join, and stays out of the
 * call as a controller. One tap moves the voice to the phone, and one tap on
 * the desk moves it back.
 */
const RIDER = 'One Voice Rider';

test('a second device is a controller, and one tap moves the voice', async ({
	browser,
	baseURL,
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider and make infra only exist against a local dev server',
	);
	test.setTimeout(120_000);

	const desk = await riders(RIDER);
	await desk.setViewportSize({ width: 1440, height: 900 });
	const opened = await channels.open(desk, `One Voice ${Date.now() % 100000}`);
	const deskMic = desk.getByRole('button', { name: 'microphone' });
	await desk
		.getByRole('button', { name: 'Join voice' })
		.click({ timeout: 15_000 });
	await expect(deskMic, 'the desk never joined voice').toBeVisible({
		timeout: 20_000,
	});
	// …and rides a session on the simulated trainer, as Jan's Mac did.
	await desk
		.getByRole('button', { name: 'Start a session' })
		.click({ timeout: 15_000 });
	const picker = desk.getByRole('dialog', { name: 'Start a session' });
	await picker
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await picker
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();
	await picker.getByRole('button', { name: 'Ride simulated' }).click();
	await picker
		.getByRole('button', { name: 'Start Recovery Spin' })
		.click({ timeout: 15_000 });
	await desk.waitForURL(`/crew/${opened.crew}/s/**`, { timeout: 30_000 });
	const ride = new URL(desk.url()).pathname;

	const { defaultBrowserType: _, ...iphone } = devices['iPhone 13'];
	const phoneContext = await browser.newContext({ ...iphone, baseURL });
	try {
		await phoneContext.addInitScript(() =>
			localStorage.setItem(
				'wattroom.mixer.v1',
				JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
			),
		);
		const phone = await phoneContext.newPage();
		// ?voice asks to join on arrival, the way a tap on the channel does.
		await signInAs(phone, RIDER, `${ride}?voice`);
		const controller = phone.getByTestId('controller');
		await expect(
			controller.getByText('Your voice is on your desktop.'),
		).toBeVisible({ timeout: 20_000 });
		await expect(
			phone.locator('[aria-label="microphone"]'),
			'the phone joined the call beside the desk',
		).toHaveCount(0);
		await expect(deskMic).toBeVisible();

		await controller
			.getByRole('button', { name: 'Use this device for voice' })
			.click();
		await expect(
			desk.getByText('Your voice is on your phone.'),
			'the desk never heard the voice moved',
		).toBeVisible({ timeout: 20_000 });
		await expect(deskMic, 'the desk stayed in the call').toHaveCount(0);
		await expect(
			controller.getByRole('button', { name: 'Use this device for voice' }),
		).toHaveCount(0);
		await expect(
			controller.getByRole('button', { name: 'Use as your remote' }),
			'the phone stopped being the remote when it took the voice',
		).toBeVisible();

		await desk
			.getByRole('button', { name: 'Use this device for voice' })
			.click();
		await expect(deskMic).toBeVisible({ timeout: 20_000 });
		await expect(
			controller.getByText('Your voice is on your desktop.'),
		).toBeVisible({ timeout: 20_000 });
	} finally {
		await phoneContext.close();
	}
});
