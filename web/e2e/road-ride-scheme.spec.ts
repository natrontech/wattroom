import { expect, test } from './crew';
import { climbGpx } from './road-gpx';
import { inRidersScheme, RIDE_FRAME } from './scheme';
import { signInAs } from './signin';

/**
 * A free ride on a road is a ride (#3667): from the first stroke to End ride
 * the frame is the ride, sidebar included, and hides the desk's sentences; a
 * stray tap on the rail asks before leaving. Every step keeps the rider's
 * scheme (Jan, 2026-10-25, #4160): captured with the OS in light, where the
 * cave used to turn the whole app dark at the first stroke.
 */
test.use({ colorScheme: 'light' });

test('a free ride on a road keeps the rider’s scheme, and asks before leaving', async ({
	page,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(120_000);
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await signInAs(page, 'Cave Road Rider', '/workouts/import');
	await page.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await page.getByRole('button', { name: 'Save to my routes' }).click();
	await expect(page.getByText(/is on your routes/)).toBeVisible();
	const { routes } = (await (await page.request.get('/api/routes')).json()) as {
		routes: { id: string }[];
	};

	await page.goto(`/ride?road=${routes[0].id}`);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	const frame = page.locator(RIDE_FRAME);
	await expect(frame, 'setup is a desk surface').toHaveCount(0);
	// The sidebar's teaching sentences are desk copy (G4, #3723): a rider in
	// no crew, with no conversation, reads them at setup and never mid-ride.
	const sidebar = page.locator('nav[aria-label="crews and channels"]');
	const teaching = [
		sidebar.getByText('Not in a crew yet'),
		sidebar.getByText('Message a friend to start one'),
		sidebar.getByText('Get the desktop app'),
	];
	for (const line of teaching) await expect(line).toBeVisible();
	await page.getByRole('button', { name: 'Start the ride' }).click();
	// The frame, page and sidebar; the hosts outside it mark their own (#3788).
	await expect(frame, 'the ride never marked the frame').toHaveCount(1);
	expect(await inRidersScheme(frame), 'the ride turned the frame dark').toBe(
		true,
	);
	for (const line of teaching)
		await expect(line, 'desk copy on a riding surface').toBeHidden();
	await expect(
		sidebar.getByRole('link', { name: 'Home', exact: true }),
		'the rows went with the sentences',
	).toBeVisible();

	await page
		.locator('nav')
		.getByRole('link', { name: 'Home', exact: true })
		.first()
		.click();
	const ask = page.getByRole('dialog', { name: 'Leave the ride?' });
	await expect(ask, 'the rail took the ride without asking').toBeVisible();
	// The OS is light, and the confirm mounts outside the frame (#3788).
	expect(await inRidersScheme(ask), 'the confirm turned dark').toBe(true);
	await ask.getByRole('button', { name: 'Keep riding' }).click();
	await expect(page).toHaveURL(/\/ride\?road=/);
	await expect(frame).toHaveCount(1);

	// End ride, which reads “Save at km x” partway up your own road (#3205).
	await page.getByRole('button', { name: /^(End ride|Save at km)/ }).click();
	await expect(page.getByRole('status')).toContainText(
		/Under a minute|Saved|Saving/,
	);
	await expect(frame, 'the ride outlived End ride').toHaveCount(0);
	for (const line of teaching) await expect(line).toBeVisible();
});
