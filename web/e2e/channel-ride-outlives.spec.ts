import { expect, test, textPath, voicePath } from './crew';
import { follow } from './follow';

/**
 * A free ride in a voice channel is the device's one ride (ADR-0093,
 * #4259): the rider reads a text channel, the sidebar docks the ride there,
 * Open brings them back to the channel's Training page, and Ride offers no
 * second one. One ride, one save.
 */
const RIDER = 'Channel Ride Roams';

test('a free ride in a voice channel runs on through a text channel, and the device has one ride', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(4 * 60_000);

	const page = await riders(RIDER);
	const opened = await channels.open(page, `Roams ${Date.now() % 100000}`);
	const training = `${voicePath(opened)}/training`;
	const dock = page.getByTestId('ride-dock');
	const end = page.getByRole('button', { name: 'End ride' });

	const since = Date.now() - 1_000;
	await page.goto(training);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await expect(end).toBeVisible({ timeout: 30_000 });
	await expect(dock, 'a dock beside its own riding screen').toHaveCount(0);

	// Off its screen the ride runs on, and the sidebar carries it.
	await follow(page, textPath(opened));
	await expect(dock, 'no dock for the channel ride off its screen').toBeVisible(
		{ timeout: 10_000 },
	);
	await expect(dock.getByTestId('ride-dock-time')).toHaveText(/^\d+:\d\d$/);
	// Open goes back to the channel's Training page while the rider is in its call.
	await dock.getByRole('link', { name: 'Open' }).click();
	await expect(page).toHaveURL((url) => url.pathname === training);
	await expect(end, 'the free ride ended off its screen').toBeVisible();
	await expect(dock).toHaveCount(0);

	// Ride is the device's one ride: it opens this one, never a second Start.
	await page.evaluate(() => {
		const link = document.createElement('a');
		link.href = '/ride';
		document.body.append(link);
		link.click();
		link.remove();
	});
	await expect(page, 'Ride offered a second ride').toHaveURL(
		(url) => url.pathname === training,
		{ timeout: 10_000 },
	);
	await expect(end).toHaveCount(1);
	await expect(
		page.getByRole('button', { name: 'Start the ride' }),
	).toHaveCount(0);

	// A free ride under a minute saves nothing (docs/SPEC.md): ride past it.
	await page.waitForTimeout(Math.max(0, since + 66_000 - Date.now()));
	await end.click();
	await expect(page.getByText('See it in your history')).toBeVisible({
		timeout: 20_000,
	});
	const saved = await page.evaluate(async (since) => {
		const res = await fetch('/api/rides');
		const { rides } = (await res.json()) as {
			rides: { startedAt: string }[];
		};
		return rides.filter((r) => Date.parse(r.startedAt) >= since).length;
	}, since);
	expect(saved, 'the ride saved as more than one').toBe(1);
});
