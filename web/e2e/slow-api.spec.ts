import { expect, test } from './crew';

/**
 * A slow server never blanks the app (#2845; errors.md: loading, never
 * blank). ssr is off, so a route whose load() awaits its reads drew nothing at
 * all — no sidebar, not even the mark — until the read came back, and a tap in
 * the sidebar looked like it had done nothing.
 */
const A = 'Slow Api Rider';

/** Longer than any assertion below waits for the frame. */
const DELAY_MS = 4_000;

test('a slow read holds the frame, and a navigation says it is loading', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Slow Api ${Date.now() % 100000}`);
	await a.route(`**/api/crews/${opened.crew}`, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
		await route.continue();
	});

	// A direct load: the mark at once, while the crew is read.
	await a.goto(`/crew/${opened.crew}`);
	await expect(a.getByText('Opening WattRoom…')).toBeVisible({
		timeout: 1_000,
	});
	await expect(a.getByTestId('page-body')).toBeVisible({
		timeout: DELAY_MS + 10_000,
	});

	// A client navigation: the page it leaves stays, with a bar that says the
	// next one is on its way.
	await a.goto('/home');
	await expect(a.getByTestId('page-body')).toBeVisible();
	await a.evaluate((crew) => {
		const link = document.createElement('a');
		link.href = `/crew/${crew}`;
		document.body.append(link);
		link.click();
	}, opened.crew);
	await expect(
		a.getByRole('progressbar', { name: 'Loading the page' }),
	).toBeVisible({ timeout: 1_000 });
	await a.waitForURL(`**/crew/${opened.crew}`, { timeout: DELAY_MS + 10_000 });
	await expect(
		a.getByRole('progressbar', { name: 'Loading the page' }),
	).toHaveCount(0);
});
