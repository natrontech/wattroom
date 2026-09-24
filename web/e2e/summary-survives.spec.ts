import { expect, test, voicePath } from './crew';

/**
 * The coach picking the next workout does not close everyone's summary
 * (#2603). The modal was drawn only while the phase read "done", and a pick
 * turns it back to idle within a second: a rider still reading theirs lost it,
 * See your ride included, with no way back.
 */
const COACH = 'Summary Keeps Coach';
const RIDER = 'Summary Keeps Rider';

/** docs/SPEC.md's session lifecycle: a 10 s countdown before the timeline. */
const COUNTDOWN_MS = 10_000;
/** A summary is worth showing once it has a minute of riding (summary.svelte.ts). */
const A_MINUTE_MS = 65_000;

test('a rider keeps their summary while the coach starts the next workout', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(240_000);

	const coach = await riders(COACH);
	const opened = await channels.open(coach, `Keeps ${Date.now() % 100000}`);
	const rider = await riders(RIDER);
	await channels.enter(rider, opened);

	for (const page of [coach, rider]) {
		await page.goto(`${voicePath(opened)}/training`);
		await page
			.getByRole('button', { name: 'Ride simulated' })
			.click({ timeout: 15_000 });
	}

	const start = async () => {
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
		await picker.getByRole('button', { name: 'Start Recovery Spin' }).click();
	};

	// A minute of riding, so both have a summary; then the coach ends it.
	// The rider joins: a session leaves everyone else alone (ADR-0059).
	await start();
	await rider
		.getByRole('link', { name: 'Join the ride' })
		.click({ timeout: COUNTDOWN_MS + 15_000 });
	const end = coach.getByRole('button', { name: 'end the session' });
	await expect(end).toBeVisible({ timeout: COUNTDOWN_MS + 30_000 });
	// The minute counts from the rider being in, not from the coach's start:
	// a join that lands late would leave them short of a summary.
	await expect(
		rider.getByRole('button', { name: 'Leave the ride' }),
	).toBeVisible({ timeout: 30_000 });
	await coach.waitForTimeout(A_MINUTE_MS);
	await end.click();
	await coach
		.getByRole('dialog')
		.getByRole('button', { name: 'End the session' })
		.click();

	const theirs = rider.getByRole('dialog', { name: 'Session summary' });
	await expect(theirs).toBeVisible({ timeout: 30_000 });
	const mine = coach.getByRole('dialog', { name: 'Session summary' });
	await expect(mine).toBeVisible({ timeout: 30_000 });

	// The coach is done with theirs: they look at the ride it saved, come back
	// to the channel, and it stays closed there. Following the link used to
	// leave it undismissed, so every return reopened it.
	await mine
		.getByRole('link', { name: 'See your ride' })
		.click({ timeout: 15_000 });
	await expect(coach).toHaveURL(/\/history\//);
	await coach.goBack();
	await expect(
		coach.getByRole('button', { name: 'Start a session' }),
	).toBeVisible({ timeout: 15_000 });
	await expect(
		mine,
		`${COACH}'s summary came back after they had seen their ride`,
	).toBeHidden();
	await start();
	await expect(
		coach.getByRole('button', { name: 'Stop the countdown' }),
	).toBeVisible({ timeout: 15_000 });

	// The rider is still reading theirs through the pick and the count-in.
	await expect(
		theirs,
		`${RIDER}'s summary closed when ${COACH} picked the next workout`,
	).toBeVisible();
});
