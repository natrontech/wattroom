import { expect, test, voicePath } from './crew';

/**
 * TV mode shows both ends of a session (#2601). Through the count-in it read
 * "No session yet" while the cues counted down; at the close, the summary
 * opened underneath it, where its own Escape dismissed it unseen.
 */
const COACH = 'TV Ends Coach';
const RIDER = 'TV Ends Rider';

/** docs/SPEC.md's session lifecycle: a 10 s countdown before the timeline. */
const COUNTDOWN_MS = 10_000;
/** A summary is worth showing once it has a minute of riding (summary.svelte.ts). */
const A_MINUTE_MS = 65_000;

test('the TV counts in, and steps aside for the summary', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(240_000);

	const coach = await riders(COACH);
	const opened = await channels.open(coach, `TV Ends ${Date.now() % 100000}`);
	const rider = await riders(RIDER);
	await channels.enter(rider, opened);

	// The rider pairs, then puts the voice channel on the big screen.
	await rider.goto(`${voicePath(opened)}/training`);
	await rider
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	// Through the app, not a reload: the simulated trainer lives in the page.
	// By its name as well as its address: the voice strip's tile of whoever is
	// in the channel links there too (#454, #2710).
	await rider
		.locator(
			`nav[aria-label="crews and channels"] a[href="${voicePath(opened)}"]`,
			{ hasText: opened.name },
		)
		.click();
	await rider.waitForURL(new RegExp(`${voicePath(opened)}$`));
	await rider.getByRole('button', { name: 'TV', exact: true }).click();
	const tv = rider.getByRole('dialog', { name: 'TV mode' });
	await expect(tv).toBeVisible();

	// The coach starts one.
	await coach.goto(voicePath(opened));
	await coach
		.getByRole('button', { name: 'Start a session' })
		.click({ timeout: 15_000 });
	const picker = coach.getByRole('dialog', { name: 'Start a session' });
	await picker
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await picker
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();
	await picker.getByRole('button', { name: 'Start without a trainer' }).click();

	// The count-in on the TV, not "No session yet".
	await expect(tv.getByText('starting', { exact: true })).toBeVisible({
		timeout: 15_000,
	});
	await expect(tv.getByText('No session yet')).toHaveCount(0);

	// A summary is a joined rider's (#2678, ADR-0059): the TV counts a
	// spectator in too, but only Join the ride makes the ride theirs. Off the
	// TV, in, and the TV back up over the ride — before the coach's minute
	// starts, so the rider has the minute a summary needs.
	await tv.getByRole('button', { name: 'Exit TV mode (esc)' }).click();
	await rider.getByRole('link', { name: 'Join the ride' }).click();
	await rider.waitForURL(/\/s\/[^/]+$/);
	await rider.getByRole('button', { name: 'TV mode' }).click();
	await expect(tv).toBeVisible();

	// A minute of riding, then the coach ends it: the TV makes way.
	const end = coach.getByRole('button', { name: 'end the session' });
	await expect(end).toBeVisible({ timeout: COUNTDOWN_MS + 30_000 });
	await coach.waitForTimeout(A_MINUTE_MS);
	await end.click();
	await coach
		.getByRole('dialog')
		.getByRole('button', { name: 'End the session' })
		.click();

	await expect(
		rider.getByRole('dialog', { name: 'Session summary' }),
	).toBeVisible({ timeout: 30_000 });
	await expect(tv, 'the TV is still up over the summary').toHaveCount(0);
});
