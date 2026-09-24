import { expect, test, voicePath } from './crew';

/**
 * Stopping the countdown is not an ending (#2605). It used to leave the
 * session "done": every rider read that it had ended and was pointed at a
 * recap that was never written, and the coach kept holding the channel.
 */
const COACH = 'Stop Count Coach';
const MEMBER = 'Stop Count Member';

test('a stopped count-in frees the channel and says only that it stopped', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const coach = await riders(COACH);
	const opened = await channels.open(coach, `Stops ${Date.now() % 100000}`);
	const member = await riders(MEMBER);
	await channels.enter(member, opened);

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

	await coach
		.getByRole('button', { name: 'Stop the countdown' })
		.click({ timeout: 30_000 });

	// The coach is taken back to the channel: there is no session to stand in.
	await coach.waitForURL(new RegExp(`${voicePath(opened)}$`), {
		timeout: 15_000,
	});
	// The member reads what happened, and nothing that did not.
	await expect(
		member.getByText('Recovery Spin was stopped before it started'),
	).toBeVisible({ timeout: 15_000 });
	await expect(member.getByText(/has ended/)).toHaveCount(0);
	// And the channel is anyone's again.
	await expect(
		member.getByRole('button', { name: 'Start a session' }),
	).toBeVisible();
});
