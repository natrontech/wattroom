import { expect, test } from './crew';

/**
 * The FTP card on /history is its content's size (#3814). It shares a grid row
 * with the power-by-duration chart, and a grid item stretches to its row, so
 * a one-ride rider's one-line empty state sat over ~240 px of empty panel.
 * docs/design/TARGETS.md G3: no empty band taller than 24 px.
 */

const RIDER = 'Ftp Card Rider';
const EMPTY_BAND_MAX = 24;

test('the FTP card has no empty band under its content', async ({ riders }) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(RIDER);
	const curve = { best5s: 700, best1m: 450, best5m: 300, best20m: 250 };
	// One ride: the FTP chart is in its sparse state, the curve chart is not.
	await a.route('**/api/progression', (route) =>
		route.fulfill({
			json: {
				curve: { d30: curve, d90: curve, all: curve },
				rides: [
					{
						id: 'ftp-card-ride',
						date: new Date().toISOString(),
						seconds: 3600,
						kj: 800,
						execution: 0.9,
						ftp: 250,
						best20m: 250,
					},
				],
				category: 'Cat 3',
				wkg: 3.2,
			},
		}),
	);

	await a.setViewportSize({ width: 1440, height: 900 });
	await a.goto('/history');
	const card = a.locator('.panel').filter({
		has: a.getByRole('heading', { name: 'FTP over the last year' }),
	});
	await expect(card).toBeVisible({ timeout: 15_000 });

	const panel = (await card.boundingBox())!;
	const last = (await card.locator(':scope > *').last().boundingBox())!;
	const padBottom = await card.evaluate((el) =>
		parseFloat(getComputedStyle(el).paddingBottom),
	);
	const band = panel.y + panel.height - (last.y + last.height) - padBottom;
	expect(band).toBeLessThanOrEqual(EMPTY_BAND_MAX);
});
