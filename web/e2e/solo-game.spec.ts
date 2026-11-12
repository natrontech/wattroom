import { expect, test } from './crew';

/**
 * A game picked on a ride alone runs on that ride (#4539). It used to open a
 * session in the rider's crew and start it the moment it was tapped: here the
 * rider has a crew with a voice channel, picks Watt Golf on the Ride card,
 * presses its Start, gets the count-in, and plays it on /ride with nothing
 * opened in the crew.
 */
test('a game alone starts from its Start, counts in, and stays off the crew', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	// Signed in muted: the game's cues play.
	const page = await riders('Solo Game Rider');
	const opened = await channels.open(page, `Solo Game ${Date.now() % 100000}`);

	const crewRequests: string[] = [];
	page.on('request', (req) => {
		if (
			req.method() === 'POST' &&
			/\/api\/crews\/[^/]+\/sessions/.test(req.url())
		)
			crewRequests.push(req.url());
	});

	await page.goto('/ride?alone');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await expect(
		page.getByText('Simulated Trainer').locator('..').getByText(/\d+ W/),
	).toBeVisible({ timeout: 15_000 });

	// Picking a game is a pick, not a start: the card says what it is, and
	// Start names it.
	await page
		.getByTestId('solo-games')
		.getByRole('button', { name: 'Watt Golf' })
		.click();
	await expect(page.getByTestId('solo-game-pick')).toContainText('Watt Golf');
	await expect(page).toHaveURL(/\/ride\?alone$/);
	await page.getByRole('button', { name: 'Start Watt Golf' }).click();

	await expect(
		page
			.getByTestId('count-in')
			.or(page.getByText('starting', { exact: true }))
			.first(),
	).toBeVisible();
	const panel = page.getByRole('status', { name: /Watt Golf, running/ });
	await expect(panel).toBeVisible({ timeout: 15_000 });
	await expect(panel).toContainText('HOLE 1 OF 9', { ignoreCase: true });
	await expect(page).toHaveURL(/\/ride\?alone$/);

	expect(crewRequests, 'the game opened a crew session').toEqual([]);
	const live = await page.evaluate(
		(crew) => fetch(`/api/crews/${crew}/live`).then((res) => res.json()),
		opened.crew,
	);
	expect(live.sessions).toEqual([]);

	// End game: the game stops, the ride goes on.
	await panel.getByRole('button', { name: 'End game' }).click();
	await expect(panel).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'End ride' })).toBeVisible();
});
