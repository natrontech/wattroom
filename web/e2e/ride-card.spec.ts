import { expect, test } from './crew';
import { importARoute } from './route';
import { signInAs } from './signin';

/**
 * /ride's Ride card (#3671): a free ride on one of your roads starts from
 * /ride itself — Free ride, Change, a road, the trainer, Start — and the next
 * visit opens on that road as “your last road”. A free ride alone with no
 * road has nothing to ride, so Start says so instead of failing.
 */
test('a free ride on your road starts from /ride, and /ride remembers the road', async ({
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
	await signInAs(page, 'Ride Card Rider', '/workouts/import');
	await importARoute(page);

	await page.goto('/ride?alone');
	const free = page.getByRole('button', { name: /^Free ride/ });
	await free.click();
	await expect(free).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	const start = page.getByRole('button', { name: 'Start the ride' });
	await expect(start, 'a free ride alone started with no road').toBeDisabled();
	await expect(page.getByText(/rides one of your roads/)).toBeVisible();

	await page.getByRole('button', { name: 'Change' }).click();
	await page
		.getByRole('list', { name: 'your routes' })
		.getByRole('button', { name: 'Ride it' })
		.first()
		.click();
	await expect(page.getByText(/^Feel: road -?\d+\.\d %/)).toBeVisible();
	await start.click();

	// On the road, riding: the road ride's own End, and its Road | Watts.
	const end = page.getByRole('button', { name: /^(End ride|Save at km)/ });
	await expect(end, 'Start never put the rider on the road').toBeVisible({
		timeout: 15_000,
	});
	await expect(page.getByRole('group', { name: 'what you set' })).toBeVisible();
	await end.click();
	await expect(page.getByRole('status')).toContainText(
		/Under a minute|Saved|Saving/,
	);

	await page.goto('/ride?alone');
	await expect(page.getByText('your last road')).toBeVisible();
	await expect(free).toHaveAttribute('aria-pressed', 'true');
});
