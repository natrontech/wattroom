import { expect, test, voicePath } from './crew';

/**
 * Easier and Harder on screen (#3330): a free ride on its grade shifts a
 * virtual gear from the pair and from the keys, each shift is heard once,
 * and the gear field is there between them. The cues are read from the
 * engine's own log line — the mixer is at zero, so nothing sounds.
 */
test('a free ride on a grade shifts from the pair and the keys, one cue a shift', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const rider = await riders('Gear Shifter');
	const cues: string[] = [];
	rider.on('console', (message) => {
		const text = message.text();
		if (text.startsWith('[cue] shift')) cues.push(text.slice(6).trim());
	});
	const opened = await channels.open(rider, `Gears ${Date.now() % 100000}`);
	await rider.evaluate(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await rider.goto(`${voicePath(opened)}/training`);
	await rider
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });

	const harder = rider.getByRole('button', { name: 'Harder', exact: true });
	await expect(harder).toBeEnabled({ timeout: 15_000 });
	await expect(rider.locator('output[aria-live="polite"]')).toBeVisible();
	await expect(
		rider.getByText('Shift with Easier and Harder, or − and + on a keyboard'),
	).toBeVisible();

	await harder.click();
	await expect.poll(() => cues).toEqual(['shift-up']);
	await rider.waitForTimeout(200);
	await rider.keyboard.press('-');
	await expect.poll(() => cues).toEqual(['shift-up', 'shift-down']);
	await rider.waitForTimeout(200);
	await rider.getByRole('button', { name: 'Easier', exact: true }).click();
	await expect
		.poll(() => cues)
		.toEqual(['shift-up', 'shift-down', 'shift-down']);

	// A desk at phone width: the pair and the gear between them fit (ux.md).
	await rider.setViewportSize({ width: 375, height: 812 });
	await expect(harder).toBeVisible();
	await expect
		.poll(() =>
			Promise.all(
				['page-body', 'place-body'].map((id) =>
					rider
						.getByTestId(id)
						.evaluate((el) => el.scrollWidth - el.clientWidth),
				),
			),
		)
		.toEqual([0, 0]);
});
