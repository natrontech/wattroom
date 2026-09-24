import { expect, test, voicePath } from './crew';

/**
 * Starting a session takes the starter to the ride (#2599). It used to leave
 * them on the voice channel's lobby, looking at camera tiles while the 3-2-1
 * played and the timeline started without them; a rider who stays there gets
 * the count-in on the lobby too.
 */
const COACH = 'Lands On Ride Coach';
const MEMBER = 'Lands On Ride Member';

test('the starter lands on the ride, and the lobby counts in too', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const coach = await riders(COACH);
	const opened = await channels.open(coach, `Lands ${Date.now() % 100000}`);
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

	// The session's own address, and its count-in.
	await coach.waitForURL(`/crew/${opened.crew}/s/**`, { timeout: 30_000 });
	await expect(
		coach.getByRole('button', { name: 'Stop the countdown' }),
	).toBeVisible();

	// Nobody else moves: the member is still on the lobby, counting in there.
	await expect(member).toHaveURL(new RegExp(`${voicePath(opened)}$`));
	await expect(member.getByText('starting', { exact: true })).toBeVisible({
		timeout: 15_000,
	});
	await expect(
		member.getByText('Recovery Spin', { exact: true }),
	).toBeVisible();
});
