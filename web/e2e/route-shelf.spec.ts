import { expect, test } from '@playwright/test';
import { importARoute } from './route';
import { signInAs } from './signin';

/**
 * The route shelf and a route's page (#3061): a stored route shows under
 * Workouts, opens on its own page with its map and climbs, takes its owner's
 * name, and goes only after the question that says what deleting it costs.
 */
test('a route on the shelf opens, renames, and deletes behind its question', async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	// Unique per run: this rider keeps their routes between runs (#2083).
	const name = `Harbour loop ${Date.now().toString(36)}`;
	await signInAs(page, 'Route Shelf', '/workouts');
	const id = await importARoute(page);
	expect(id).toMatch(/.+/);

	await page.goto('/workouts');
	// The one route row (#3683): name, class chip, stat line, how it was ridden.
	const link = page.locator(`a[href="/workouts/routes/${id}"]`);
	const card = page.getByRole('listitem').filter({ has: link });
	await expect(link).toContainText(/^Road · 3\.0 km/);
	await expect(card).toContainText('IV');
	await expect(card).toContainText(/3\.0 km · \d+ m · 1 climb/);
	await expect(card).toContainText('Not ridden yet');
	await link.click();

	await expect(
		page.getByRole('heading', { name: /^Road · 3\.0 km/ }),
	).toBeVisible();
	// The map, when this server holds the key that seals one; its heights and
	// the line saying why, when it does not — CI runs without the key.
	const { hasPlace } = (await (
		await page.request.get(`/api/routes/${id}`)
	).json()) as { hasPlace: boolean };
	if (hasPlace)
		await expect(page.getByRole('img', { name: /from above/ })).toBeVisible();
	else await expect(page.getByText(/heights, not its map/)).toBeVisible();
	await expect(page.getByRole('list', { name: 'Climbs' })).toContainText('IV');
	// Route rides landed (#3596): Ride it rides it, where a dev server opens
	// the roads gate (#3027).
	await expect(page.getByRole('link', { name: 'Ride it' })).toHaveAttribute(
		'href',
		`/ride?road=${id}`,
	);

	await page.getByLabel('your name for it').fill(name);
	await page.getByRole('button', { name: 'Rename' }).click();
	await expect(page.getByRole('heading', { name })).toBeVisible();

	// Kept on "Keep it", gone on the action — and the question names the cost.
	await page.getByRole('button', { name: 'Delete the route' }).click();
	await expect(
		page.getByText(
			'Plans that carry it lose their road. Your rides keep theirs.',
		),
	).toBeVisible();
	await page.getByRole('button', { name: 'Keep it' }).click();
	await expect(page.getByRole('heading', { name })).toBeVisible();

	await page.getByRole('button', { name: 'Delete the route' }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Delete the route' })
		.click();
	await page.waitForURL('**/workouts');
	await expect(page.locator(`a[href="/workouts/routes/${id}"]`)).toHaveCount(0);

	// And its address now says so, instead of an error.
	await page.goto(`/workouts/routes/${id}`);
	await expect(page.getByText("This route isn't here.")).toBeVisible();
});

// A route card's Ride is the way onto the road (#3683, flow F1): from the
// shelf straight to /ride on it, and riding.
test("a route card's Ride rides the road", async ({ page }) => {
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
	await signInAs(page, 'Route Card Rider', '/workouts');
	const id = await importARoute(page);
	await page.goto('/workouts');
	const card = page
		.getByRole('listitem')
		.filter({ has: page.locator(`a[href="/workouts/routes/${id}"]`) });
	await card.getByRole('link', { name: /^(Ride|Carry on)$/ }).click();
	await expect(page).toHaveURL(new RegExp(`/ride\\?road=${id}`));
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
