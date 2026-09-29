import { expect, test } from './crew';
import { signInAs } from './signin';

/**
 * A game from the solo ride (#3276): /ride's door opens the rider's lounge,
 * starts the game there with them as coach, and its end leaves the crew's
 * recap like any session. A rider in no crew sees the doors disabled, with
 * the line that says why.
 */
test.skip(
	!!process.env.PLAYWRIGHT_BASE_URL,
	'the ?as= dev provider only exists on a dev server',
);

test('a solo Watt Golf starts from /ride and saves as a game ride in the channel', async ({
	riders,
	channels,
}) => {
	// A ride is kept from its 60th second (MinRideSamples), so this one rides
	// a little over a minute on the simulated trainer.
	test.setTimeout(180_000);
	const page = await riders('Solo Golfer');
	const opened = await channels.open(page, `Solo Golf ${Date.now() % 100000}`);
	const since = Date.now();
	await page.goto('/ride');

	await page
		.getByTestId('solo-games')
		.getByRole('button', { name: 'Watt Golf' })
		.click({ timeout: 15_000 });
	// The game is a session in the lounge, and the rider coaches it: they go
	// to its own page, where End game is theirs.
	await expect(page).toHaveURL(new RegExp(`/crew/${opened.crew}/s/[^/?]+$`), {
		timeout: 15_000,
	});
	const end = page.getByRole('button', { name: 'end the game' });
	await expect(end).toBeVisible({ timeout: 15_000 });

	await page
		.getByRole('button', { name: 'Ride simulated' })
		.first()
		.click({ timeout: 15_000 });
	// Watt Golf hides the meter (docs/SPEC.md), so what shows the ride is the
	// crew's own line: one riding.
	await expect(page.getByText(/· 1 riding/).first()).toBeVisible({
		timeout: 15_000,
	});
	await page.waitForTimeout(65_000);

	await end.click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'End the game' })
		.click();
	await expect
		.poll(
			() =>
				page.evaluate(
					async ({ crew, since }) => {
						const recaps = (
							(await fetch(`/api/crews/${crew}/recaps`).then((res) =>
								res.json(),
							)) as {
								recaps: {
									workout: string;
									endedAt: number;
									riders: { rider: string; rode: boolean }[];
								}[];
							}
						).recaps;
						const rides = (
							(await fetch('/api/rides').then((res) => res.json())) as {
								rides: { workoutName: string; startedAt: string }[];
							}
						).rides;
						return {
							recap: recaps.some(
								(r) =>
									r.workout === 'Watt Golf' &&
									r.endedAt >= since &&
									r.riders.some((x) => x.rider === 'Solo Golfer' && x.rode),
							),
							ride: rides.some(
								(r) =>
									r.workoutName === 'Watt Golf' &&
									Date.parse(r.startedAt) >= since - 5_000,
							),
						};
					},
					{ crew: opened.crew, since },
				),
			{ message: 'the solo game left no ride in the channel', timeout: 20_000 },
		)
		.toEqual({ recap: true, ride: true });
});

test('a rider in no crew sees the game doors disabled, and why', async ({
	page,
}) => {
	await signInAs(page, 'Crewless Soloist', '/ride');
	const games = page.getByTestId('solo-games');
	await expect(games.getByTestId('solo-games-hint')).toHaveText(
		"Games run in a crew's voice channel. Start a crew.",
		{ timeout: 15_000 },
	);
	for (const name of ['Watt Golf', 'Floor is Lava', 'Backyard Ramp'])
		await expect(games.getByRole('button', { name })).toBeDisabled();
});
