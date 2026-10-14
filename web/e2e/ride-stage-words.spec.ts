import { expect, test, voicePath } from './crew';

/**
 * A voice channel's stage is a riding surface while its session runs
 * (TARGETS G1, #3890, #3882): the frame is the cave, and a rider a game put
 * out uses the page on the bike. Its tiles, the session's controls and the
 * door to the ride kept the desk's 9–16 px words, which nobody reads from
 * the saddle. G4's floor is 24 px for every word there at a desk's width.
 */
const RIDER = 'Ride Stage Coach';
const WORD = 24;

test("a voice channel's stage words are riding size while its session runs", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const page = await riders(RIDER);
	await page.setViewportSize({ width: 1440, height: 900 });
	const opened = await channels.open(page, `Stage ${Date.now() % 100000}`);

	await page.goto(voicePath(opened));
	await page
		.getByRole('button', { name: 'Start a session' })
		.click({ timeout: 15_000 });
	const picker = page.getByRole('dialog', { name: 'Start a session' });
	await picker
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await picker
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();
	await picker.getByRole('button', { name: 'Start without a trainer' }).click();
	await page.waitForURL(`/crew/${opened.crew}/s/**`, { timeout: 30_000 });

	// Back beside the ride, on the channel's own page: from the count-in on
	// its stage is ridden.
	await page.goto(voicePath(opened));
	const stage = page.locator('[data-ride-stage]');
	await expect(stage).toBeVisible({ timeout: 30_000 });
	await expect(
		stage.getByRole('link', { name: 'Go to the ride' }),
	).toBeVisible();
	await expect(stage.getByTestId('tile-name').first()).toBeVisible();

	/** Every visible word on the stage under the floor, by its text. */
	const small = () =>
		stage.evaluate((root, floor) => {
			const found: string[] = [];
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const text = node.textContent?.trim();
				const el = node.parentElement;
				if (!text || !el || !el.checkVisibility()) continue;
				// An avatar's initial is a picture of a person, not a word, and
				// its label is for a screen reader.
				if (el.closest('[data-avatar], .sr-only')) continue;
				const size = parseFloat(getComputedStyle(el).fontSize);
				if (size < floor) found.push(`"${text}" at ${size}px`);
			}
			return found;
		}, WORD);
	await expect
		.poll(small, { message: 'words on the ridden stage under 24 px' })
		.toEqual([]);
});
