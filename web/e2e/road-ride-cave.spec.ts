import { expect, test } from './crew';
import { climbGpx } from './road-gpx';
import { signInAs } from './signin';

/**
 * A free ride on a road is a ride (#3667): from the first stroke to End ride
 * the frame is the cave, sidebar included, whatever the OS scheme says; a
 * stray tap on the rail asks before leaving; the card after End ride follows
 * the rider's scheme again. Captured with the OS in light, where the ride
 * used to stay white from end to end.
 */
test.use({ colorScheme: 'light' });

test('a free ride on a road rides in the cave, and asks before leaving', async ({
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
	await expect(page.locator('.cave'), 'setup is a desk surface').toHaveCount(0);
	await page.getByRole('button', { name: 'Start riding' }).click();
	// The frame, page and sidebar; the hosts outside it wear their own (#3788).
	const cave = page.locator('.cave:has(#page-body)');
	await expect(cave, 'the lights stayed up').toHaveCount(1);

	await page
		.locator('nav')
		.getByRole('link', { name: 'Home', exact: true })
		.first()
		.click();
	const ask = page.getByRole('dialog', { name: 'Leave the ride?' });
	await expect(ask, 'the rail took the ride without asking').toBeVisible();
	// The OS is light, and the confirm mounts outside the frame (#3788).
	expect(
		await ask.evaluate((el) => getComputedStyle(el).colorScheme),
		'the confirm drew in daylight over the ride',
	).toBe('dark');
	await ask.getByRole('button', { name: 'Keep riding' }).click();
	await expect(page).toHaveURL(/\/ride\?road=/);
	await expect(cave).toHaveCount(1);

	// End ride, which reads “Save at km x” partway up your own road (#3205).
	await page.getByRole('button', { name: /^(End ride|Save at km)/ }).click();
	await expect(page.getByRole('status')).toContainText(
		/Under a minute|Saved|Saving/,
	);
	await expect(page.locator('.cave'), 'the cave outlived End ride').toHaveCount(
		0,
	);
});
