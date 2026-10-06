import { expect, test } from '@playwright/test';
import { importARoute } from './route';
import { signInAs } from './signin';

/**
 * The route page (#3680): its stat row, how to ride it, and a Ride it that
 * rides — from the whole road, or from the foot of one climb.
 */
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
});

test("the route page's Ride it rides the road", async ({ page }) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(120_000);
	await signInAs(page, 'Route Page Rider', '/workouts');
	const id = await importARoute(page);
	await page.goto(`/workouts/routes/${id}`);
	await expect(
		page.getByText(/^3\.0 km · \d+ m climbed · 1 classed climb · /),
	).toBeVisible();

	// One climb starts at its foot (this road's is its first metre); the
	// whole road from the start.
	const ride = page.getByRole('link', { name: 'Ride it' });
	await page.getByRole('button', { name: 'One climb' }).click();
	await expect(
		page.getByText(
			/^From the foot of Climb 1 at km \d+\.\d; its top is at km \d+\.\d\.$/,
		),
	).toBeVisible();
	await expect(ride).toHaveAttribute(
		'href',
		new RegExp(`^/ride\\?road=${id}(&from=\\d+)?$`),
	);
	await page.getByRole('button', { name: 'Whole road' }).click();
	await expect(ride).toHaveAttribute('href', `/ride?road=${id}`);

	await ride.click();
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	const fromStart = page.getByRole('button', { name: 'From the start' });
	const start = page.getByRole('button', { name: 'Start riding' });
	await expect(start.or(fromStart)).toBeVisible();
	if (await fromStart.isVisible()) await fromStart.click();
	else await start.click();
	await expect(
		page.getByRole('button', { name: /^(End ride|Save at km)/ }),
	).toBeVisible({ timeout: 15_000 });
});
