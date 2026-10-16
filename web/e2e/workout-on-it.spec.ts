import { expect, test } from './crew';
import { importARoute } from './route';
import { signInAs } from './signin';

/**
 * Workout on it (#3681): from a route page, pick a workout on /workouts?on=,
 * and its Ride opens the road's start, not a second list of roads.
 */
test('the route page picks a workout for its road and rides it', async ({
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
	await signInAs(page, 'Workout On It Rider', '/workouts');
	const routeId = await importARoute(page);
	const { name } = (await (
		await page.request.get(`/api/routes/${routeId}`)
	).json()) as { name: string };

	await page.goto(`/workouts/routes/${routeId}`);
	const how = page.getByRole('complementary', { name: 'how to ride it' });
	await how.getByRole('button', { name: /Workout on it/ }).click();
	await expect(how.getByText('Which stretch')).toHaveCount(0);
	await how.getByRole('link', { name: 'Pick a workout' }).click();

	await expect(page).toHaveURL(`/workouts?on=${routeId}`);
	const banner = page.getByRole('status').filter({ hasText: 'Pick a workout' });
	await expect(banner).toContainText(
		`Pick a workout for ${name} · Terrain Match picks the start`,
	);
	await expect(banner.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
		'href',
		`/workouts/routes/${routeId}`,
	);

	await page
		.getByRole('listitem')
		.filter({
			has: page.getByRole('link', { name: 'Recovery Spin', exact: true }),
		})
		.getByRole('button', { name: 'Ride', exact: true })
		.click();
	const picker = page.getByRole('dialog', { name: 'Ride it on a route' });
	await expect(picker).toContainText(`${name} — where to start?`);
	await picker
		.getByRole('link', { name: /^From km/ })
		.first()
		.click();

	await expect(page).toHaveURL(
		new RegExp(`/ride\\?w=recovery-spin&road=${routeId}&from=\\d+`),
	);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	await expect(page.getByTestId('block-road')).toContainText('of 3.0', {
		timeout: 15_000,
	});
});
