import { devices, type BrowserContext } from '@playwright/test';
import { expect, test, voicePath } from './crew';
import { signInAs } from './signin';

/**
 * Jan's ride, 2026-10-25 (#4163): a desk rides a crew session holding the
 * trainer, the same rider's phone opens the remote, and Harder on the phone
 * moves the desk's bias, since the session rides in ERG (#3333). Both
 * screens run as wattroom.ch serves them, with no dev door, and gears are
 * on there too. The desk takes the dev door only to pair its simulated
 * trainer.
 */
const RIDER = 'Phone Remote Rider';

/** The providers as production lists them: no dev door. */
const asProduction = (context: BrowserContext) =>
	context.route('**/api/auth/providers', async (route) => {
		const res = await route.fetch();
		const body = (await res.json()) as { providers?: string[] };
		body.providers = (body.providers ?? []).filter((p) => p !== 'dev');
		await route.fulfill({ response: res, json: body });
	});

test('Harder on the phone remote trims the desk ride in ERG', async ({
	browser,
	baseURL,
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const desk = await riders(RIDER);
	await desk.setViewportSize({ width: 1440, height: 900 });
	await desk
		.context()
		.addInitScript(() =>
			localStorage.setItem('wattroom.world.mode.v1', 'flat'),
		);
	const opened = await channels.open(desk, `Remote ${Date.now() % 100000}`);
	await desk.goto(voicePath(opened));
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

	// Paired; from here the desk reads the providers as production lists
	// them. Its shell re-reads them on every mount, so a walk to the lounge
	// and back, inside the app, keeps the ride and drops the dev door.
	await asProduction(desk.context());
	await desk
		.locator(`a[href="${voicePath(opened)}"]`)
		.first()
		.click();
	await desk.waitForURL(voicePath(opened));
	await desk.goBack();
	await desk.waitForURL(ride);
	const raise = desk.getByRole('button', {
		name: 'raise the target by one percent',
	});
	await expect(raise).toBeEnabled({ timeout: 30_000 });
	await expect(desk.getByText('100%', { exact: true })).toBeVisible();

	const { defaultBrowserType: _, ...iphone } = devices['iPhone 13'];
	const phoneContext = await browser.newContext({ ...iphone, baseURL });
	try {
		await phoneContext.addInitScript(() =>
			localStorage.setItem(
				'wattroom.mixer.v1',
				JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
			),
		);
		await asProduction(phoneContext);
		const phone = await phoneContext.newPage();
		await signInAs(phone, RIDER, ride);
		await phone
			.getByRole('button', { name: 'Use as your remote' })
			.click({ timeout: 20_000 });
		const remote = phone.getByTestId('phone-remote');
		await remote.getByRole('button', { name: 'Harder', exact: true }).click();

		await expect(desk.getByText('101%', { exact: true })).toBeVisible({
			timeout: 10_000,
		});
		await expect(
			remote.getByText('Dimmed: on the riding screen only.'),
		).toBeVisible();
	} finally {
		await phoneContext.close();
	}
});
