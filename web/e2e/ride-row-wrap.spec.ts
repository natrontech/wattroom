import { expect, test } from './crew';

/**
 * A ride row whose meta wraps keeps every wrapped item on the card's text
 * edge (#3806). The share toggle is a ghost button whose own padding sat
 * between its box and its words, so on a second line it started 12 px right
 * of the row's title.
 */

const RIDER = 'Ride Row Wrap Rider';

test("a wrapped Share with friends starts on the row's text edge", async ({
	riders,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(RIDER);
	// The ride is the server's answer, stubbed: the row's layout is the
	// subject, and a real ride is ride.spec.ts's.
	await a.route('**/api/rides', (route) =>
		route.fulfill({
			json: {
				rides: [
					{
						id: 'ride-row-wrap-ride',
						workoutName: 'Sweet Spot Over Unders With A Long Name',
						startedAt: new Date().toISOString(),
						seconds: 5400,
						kj: 1420,
						avgWatts: 263,
						execution: 0.9,
						ftp: 250,
						xp: 10,
						sharedWithFriends: false,
					},
				],
			},
		}),
	);

	await a.setViewportSize({ width: 375, height: 812 });
	await a.goto('/history');
	const row = a.locator('li#ride-ride-row-wrap-ride');
	await expect(row).toBeVisible({ timeout: 15_000 });

	const title = await row.locator('span.font-display').first().boundingBox();
	const share = row.getByRole('button', { name: 'Share with friends' });
	const box = await share.boundingBox();
	// It wrapped: the toggle sits on a line below the title's.
	expect(box!.y).toBeGreaterThan(title!.y + title!.height);
	// Its words, not its box, are what a rider's eye lines up.
	const inset = await share.evaluate((el) =>
		parseFloat(getComputedStyle(el).paddingLeft),
	);
	expect(box!.x + inset).toBeCloseTo(title!.x, 0);
});
