import { expect, test } from './crew';
import { follow } from './follow';
import { climbGpx } from './road-gpx';
import { inRidersScheme, RIDE_FRAME } from './scheme';
import { signInAs } from './signin';

/**
 * A free ride on a road is a ride (#3667): from the first stroke to End ride
 * the frame is the ride, sidebar included, and hides the desk's sentences.
 * It is the rider's (ADR-0093, #4259): the rail opens another page without
 * asking, the ride runs on there, and /ride draws it again. Every step keeps
 * the rider's scheme (Jan, 2026-10-25, #4160): captured with the OS in light,
 * where the cave used to turn the whole app dark at the first stroke.
 */
test.use({ colorScheme: 'light' });

test('a free ride on a road keeps the rider’s scheme, and runs on off its page', async ({
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
	// The climb is the ride's, not the screen's: it carries on past a return.
	const climbed = async () =>
		Number(
			/(\d+) m climbed/.exec(
				(await page
					.getByText(/\d+ m climbed/)
					.first()
					.textContent()) ?? '',
			)?.[1],
		);
	await expect.poll(climbed, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
	const before = await climbed();

	await page
		.locator('nav')
		.getByRole('link', { name: 'Home', exact: true })
		.first()
		.click();
	await page.waitForURL((url) => url.pathname === '/home', {
		timeout: 15_000,
	});
	await expect(page.getByRole('dialog'), 'the rail asked mid-ride').toHaveCount(
		0,
	);
	// Off its screens the ride runs on unseen, and the frame is a desk frame.
	await expect(frame, 'Home wore the ride’s frame').toHaveCount(0);
	await follow(page, '/ride');
	await expect(frame, 'the ride ended when its page closed').toHaveCount(1);
	expect(await climbed(), 'the climb began again at 0').toBeGreaterThanOrEqual(
		before,
	);

	// End ride, which reads “Save at km x” partway up your own road (#3205).
	await page.getByRole('button', { name: /^(End ride|Save at km)/ }).click();
	await expect(page.getByRole('status')).toContainText(
		/Under a minute|Saved|Saving/,
	);
	await expect(frame, 'the ride outlived End ride').toHaveCount(0);
	for (const line of teaching) await expect(line).toBeVisible();
});
