import { expect, test } from './crew';

/**
 * A ride row whose meta wraps keeps every wrapped item on the card's text
 * edge (#3806). The share toggle is a ghost button whose own padding sat
 * between its box and its words, so on a second line it started 12 px right
 * of the row's title.
 */

const RIDER = 'Ride Row Wrap Rider';

const RIDE = {
	startedAt: new Date().toISOString(),
	seconds: 5400,
	kj: 1420,
	avgWatts: 263,
	execution: 0.9,
	ftp: 250,
	xp: 10,
	sharedWithFriends: false,
};

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
						...RIDE,
						id: 'ride-row-wrap-ride',
						workoutName: 'Sweet Spot Over Unders With A Long Name',
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

/**
 * A card is as tall as what it holds (#3818). Two rows share a grid row on a
 * desk; the one whose words wrapped used to stretch its neighbour, which then
 * held a blank band under its single line.
 */
test('a one-line ride row is not stretched by a neighbour that wraps', async ({
	riders,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(`${RIDER} Pair`);
	await a.route('**/api/rides', (route) =>
		route.fulfill({
			json: {
				rides: [
					{ ...RIDE, id: 'ride-row-short', workoutName: 'Design ride' },
					{
						...RIDE,
						id: 'ride-row-long',
						workoutName:
							'Sweet Spot Over Unders With A Very Long Name That Takes Two Lines',
					},
				],
			},
		}),
	);

	for (const size of [
		{ width: 1440, height: 900 },
		{ width: 375, height: 812 },
	]) {
		await a.setViewportSize(size);
		await a.goto('/history');
		const row = a.locator('li#ride-ride-row-short');
		await expect(row).toBeVisible({ timeout: 15_000 });

		const blank = await row.evaluate((li) => {
			const box = li.getBoundingClientRect();
			const style = getComputedStyle(li);
			const bottoms = [...li.querySelectorAll('span, button')].map(
				(el) => el.getBoundingClientRect().bottom,
			);
			const content = Math.max(...bottoms) + parseFloat(style.paddingBottom);
			return box.bottom - content;
		});
		// Its own padding and its content, not its neighbour's height.
		expect(blank, `at ${size.width} px`).toBeLessThanOrEqual(8);

		// Nor does a long name make its neighbour a different height: the
		// column beside it would hold a hole.
		const heights = await a
			.locator('li[id^="ride-ride-row-"]')
			.evaluateAll((lis) => lis.map((li) => li.getBoundingClientRect().height));
		if (size.width > 1000) {
			expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(
				8,
			);
		}
	}
});
