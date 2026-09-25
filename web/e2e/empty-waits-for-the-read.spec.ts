import { expect, test, type Page, type Route } from '@playwright/test';
import { signInAs } from './signin';

/**
 * An empty state is an answer, not a default (#2848, errors.md: a failed read
 * is not an empty list). While a read was out, or after it failed, three
 * surfaces told a rider who already had crews, tracks or conversations to
 * make their first — Home's biggest button founded a duplicate crew against
 * a cap of three.
 */

const RIDER = 'Empty Waits Rider';

const refuse = (route: Route) =>
	route.fulfill({
		status: 500,
		json: { error: 'internal_error', message: 'That did not load. Try again.' },
	});

/** Refuse GETs of exactly `path`; anything else goes through. */
async function failGet(page: Page, path: string) {
	await page.route(`**${path}`, (route) =>
		route.request().method() === 'GET' ? refuse(route) : route.continue(),
	);
}

test.beforeEach(async () => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
});

test('Home offers no crew to start while the crew list is out, or after it failed', async ({
	page,
}) => {
	await signInAs(page, RIDER, '/workouts');
	// Held, then refused: the button must not appear in either state.
	let release = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/api/crews', async (route) => {
		if (route.request().method() !== 'GET') return route.continue();
		await held;
		return refuse(route);
	});
	await page.goto('/home');
	await expect(page.getByRole('link', { name: /Ride solo/ })).toBeVisible();
	const start = page.getByRole('button', {
		name: /^(Start a crew|Join a crew)$/,
	});
	await expect(start).toHaveCount(0);
	release();
	await expect(
		page.getByText('That did not load. Try again.').first(),
	).toBeVisible();
	await expect(start).toHaveCount(0);
});

test('Music does not invite a first upload over a library that did not load', async ({
	page,
}) => {
	await signInAs(page, RIDER, '/workouts');
	await failGet(page, '/api/tracks');
	await page.goto('/music');
	await expect(
		page.getByText('That did not load. Try again.').first(),
	).toBeVisible();
	await expect(page.getByText('Add the first tracks')).toHaveCount(0);
	await expect(page.getByText('This is your library.')).toHaveCount(0);
});

test('the sidebar says messages did not load, not "start one"', async ({
	page,
}) => {
	await signInAs(page, RIDER, '/workouts');
	await failGet(page, '/api/dms');
	await page.goto('/home');
	await expect(page.getByText('Messages did not load.')).toBeVisible();
	await expect(page.getByText('Message a friend to start one')).toHaveCount(0);
});
