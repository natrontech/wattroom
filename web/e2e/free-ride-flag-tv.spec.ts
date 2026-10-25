import { expect, test, voicePath } from './crew';

/**
 * A voice channel's free ride has the ⚑ and TV a workout ride has (#3894,
 * ADR-0046): both sit in slot 1's row once the ride is going, the ⚑ says
 * what it sends afterwards, and TV opens a frame of the 3 s power and the
 * clock that Escape closes.
 */
test('a free ride in a voice channel flags and opens TV', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const rider = await riders('Free Flag Rider');
	const opened = await channels.open(rider, `Free Flag ${Date.now() % 100000}`);
	await rider.evaluate(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	// The design shots' desk, where the ride's row is at its narrowest.
	await rider.setViewportSize({ width: 1440, height: 900 });
	await rider.goto(`${voicePath(opened)}/training`);
	await rider
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });

	const tvButton = rider.getByRole('button', { name: 'TV mode' });
	await expect(tvButton).toBeVisible({ timeout: 20_000 });
	// Warm up and Cool down take their own row (#4100): End ride stays
	// in the ride's row, beside ⚑ and TV.
	const end = rider.getByRole('button', { name: 'End ride' });
	const middle = async (button: typeof end) => {
		const box = (await button.boundingBox())!;
		return box.y + box.height / 2;
	};
	expect(Math.abs((await middle(end)) - (await middle(tvButton)))).toBeLessThan(
		4,
	);
	await rider.getByRole('button', { name: 'Flag a problem' }).click();
	await expect(rider.getByText(/^Flagged — after the ride/)).toBeVisible();

	await tvButton.click();
	const tv = rider.getByRole('dialog', { name: 'TV mode' });
	await expect(tv).toBeVisible();
	await rider.keyboard.press('Escape');
	await expect(tv).toBeHidden();
});
