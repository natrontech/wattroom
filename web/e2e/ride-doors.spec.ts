import { expect, test } from './crew';

/**
 * The two doors (#3274): a rider with a crew chooses, on /ride and on Home,
 * between riding alone and riding in the crew's lounge where the crew can
 * drop in. Alone is one tap and broadcasts nothing; the lounge opens the
 * voice channel's free ride and says once who sees the numbers there.
 *
 * The rider's crew outlives the spec (crew.ts), so the lounge may be a voice
 * channel an earlier run opened: the lounge rule has its own unit test, and
 * this one follows whichever channel the door names.
 */
test.skip(
	!!process.env.PLAYWRIGHT_BASE_URL,
	'the ?as= dev provider only exists on a dev server',
);

test('Ride alone is one tap on /ride, huge on a phone, and broadcasts nothing', async ({
	riders,
	channels,
}) => {
	const page = await riders('Doors Alone');
	const opened = await channels.open(page, `Doors ${Date.now() % 100000}`);
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto('/ride');

	const alone = page.getByTestId('ride-alone');
	const lounge = page.getByTestId('ride-in-lounge');
	await expect(alone).toBeVisible({ timeout: 15_000 });
	await expect(lounge).toBeVisible();
	for (const door of [alone, lounge]) {
		const box = await door.boundingBox();
		expect(
			box!.height,
			'a door a rider can hit on the bike',
		).toBeGreaterThanOrEqual(44);
	}

	await alone.click();
	await expect(
		page.getByRole('button', { name: 'Ride simulated' }),
	).toBeVisible();
	await expect(page).toHaveURL(/\/ride$/);
	// Nobody sees a solo ride: the rider stands in no voice channel for it.
	const standing = await page.evaluate(async (crew) => {
		const live = (await fetch('/api/crews/live').then((res) => res.json())) as {
			crews: { id: string; channels: { occupants?: { name: string }[] }[] }[];
		};
		return live.crews
			.filter((c) => c.id === crew)
			.flatMap((c) => c.channels.flatMap((ch) => ch.occupants ?? []))
			.map((o) => o.name);
	}, opened.crew);
	expect(standing).not.toContain('Doors Alone');
});

test("Home's lounge door opens the channel's free ride and says who sees it", async ({
	riders,
	channels,
}) => {
	const page = await riders('Doors Lounge');
	const opened = await channels.open(page, `Doors ${Date.now() % 100000}`);
	await page.goto('/home');

	const doors = page.getByTestId('ride-doors');
	await expect(doors.getByTestId('ride-in-lounge')).toBeVisible({
		timeout: 15_000,
	});
	await expect(
		doors.getByText('whoever has it open sees your live watts'),
	).toBeVisible();
	await expect(doors.getByTestId('lounge-now')).toContainText(
		'Your mic starts off.',
	);

	await doors.getByTestId('ride-in-lounge').click();
	await expect(page).toHaveURL(
		new RegExp(`/crew/${opened.crew}/v/[^/]+/training$`),
		{ timeout: 15_000 },
	);
	await expect(
		page.getByRole('button', { name: 'Ride simulated' }),
	).toBeVisible({
		timeout: 15_000,
	});

	// The door taken last leads next time, on /ride too.
	await page.goto('/ride');
	const first = page.getByTestId('ride-doors').getByRole('button').first();
	await expect(first).toHaveAttribute('data-testid', 'ride-in-lounge', {
		timeout: 15_000,
	});
});
