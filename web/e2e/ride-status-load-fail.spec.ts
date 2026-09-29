import { expect, test, textPath, voicePath } from './crew';

/**
 * The ride's status survives its own place's page failing to load (#2986).
 * A rider on a free ride walks into chat, the server drops, and they tap
 * their voice channel: its load needs the server, so the page is a load error
 * and the shell that draws the ride's status never mounts. The frame used to
 * leave it to that shell because the path said "on the place" — and the
 * reconnect, the riding held on this device and End ride all went with it.
 *
 * Counted by the status's own marker rather than by a banner: the status
 * draws nothing while all is well, and a real outage also takes the page's
 * other reads down, which is a different failure from this one.
 */
test("a held ride's status is drawn exactly once, even on its place's page when that page cannot load", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(120_000);

	const page = await riders('Status Fallback Rider');
	const opened = await channels.open(page, `Fallback ${Date.now() % 100000}`);
	const status = page.getByTestId('ride-status');
	const sidebar = (href: string) =>
		page.locator(`nav[aria-label="crews and channels"] a[href="${href}"]`);

	// A free ride on the simulator, in the voice channel. Its shell draws the
	// status, and the frame stands aside: one, not two.
	await page.goto(`${voicePath(opened)}/training`);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await expect(
		page.getByRole('button', { name: 'End ride' }),
		'the free ride never started recording',
	).toBeVisible({ timeout: 30_000 });
	await expect(status, 'the shell and the frame both drew it').toHaveCount(1);

	// On into chat: the recording comes along, and the frame draws it (#2885).
	await sidebar(textPath(opened)).click();
	await page.waitForURL(`**${textPath(opened)}`);
	await expect(
		status,
		'the status did not follow the ride into chat',
	).toHaveCount(1);

	// Back to the voice channel with the server gone for its reads: the page
	// is a load error, the shell never mounts, and the status is there anyway.
	await page.route(/\/api\/crews\//, (route) => route.abort());
	try {
		await sidebar(voicePath(opened)).click();
		await page.waitForURL(`**${voicePath(opened)}`);
		await expect(
			page.getByRole('button', { name: /retry/i }),
			'the voice channel loaded after all — the test never reached the case',
		).toBeVisible({ timeout: 15_000 });
		await expect(
			status,
			"the voice channel's load error hid the held ride's status",
		).toHaveCount(1);
	} finally {
		// The fixture hands the crew back through the same API at teardown.
		await page.unrouteAll({ behavior: 'ignoreErrors' });
	}
});
