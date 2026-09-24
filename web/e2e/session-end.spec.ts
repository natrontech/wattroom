import { expect, test, voicePath } from './crew';

/**
 * The end of a session lets go of its address (#2600). A rider finished on
 * the session's page stayed there; a reload fell out of voice onto "This
 * session has ended", pointing at the crew rather than the call they were in.
 */
const RIDER = 'Session End Rider';

test('an ended session hands its address back to its voice channel', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const page = await riders(RIDER);
	const opened = await channels.open(page, `Ends ${Date.now() % 100000}`);

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
	const session = page.url().split('/s/')[1].split(/[/?#]/)[0];

	// Running, then ended by its coach.
	await page
		.getByRole('button', { name: 'end the session' })
		.click({ timeout: 30_000 });
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'End the session' })
		.click();

	// The page lets go: back to the channel the session ran in.
	await page.waitForURL(new RegExp(`${voicePath(opened)}$`), {
		timeout: 15_000,
	});

	// And the address, opened cold once the recap has landed, leads there too.
	await expect
		.poll(
			() =>
				page.evaluate(
					async ({ crew, session }) => {
						const res = await fetch(`/api/crews/${crew}/recaps`);
						const { recaps } = (await res.json()) as {
							recaps: { sessionId?: string }[];
						};
						return recaps.some((r) => r.sessionId === session);
					},
					{ crew: opened.crew, session },
				),
			{ message: 'the session left no recap', timeout: 15_000 },
		)
		.toBe(true);
	await page.goto(`/crew/${opened.crew}/s/${session}`);
	await page.waitForURL(new RegExp(`${voicePath(opened)}$`), {
		timeout: 15_000,
	});
});
