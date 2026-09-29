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
	const card = page.locator(`a[href="/workouts/routes/${id}"]`);
	await expect(card).toContainText(/^Road · 3\.0 km/);
	await expect(card).toContainText('Climbs: IV');
	await card.click();

	await expect(
		page.getByRole('heading', { name: /^Road · 3\.0 km/ }),
	).toBeVisible();
	await expect(page.getByRole('img', { name: /from above/ })).toBeVisible();
	await expect(page.getByRole('list', { name: 'Climbs' })).toContainText('IV');
	await expect(page.getByRole('button', { name: 'Ride it' })).toBeDisabled();

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
