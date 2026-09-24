import { expect, test, voicePath } from './crew';

/**
 * The crew's owner ends a session somebody else is coaching (#2598). The
 * hub always allowed it (TestAdminEnds); the only End on screen was the
 * coach's, so a session left running held the voice channel shut.
 */
const OWNER = 'Admin Ends Owner';
const COACH = 'Admin Ends Coach';

/** docs/SPEC.md's session lifecycle: a 10 s countdown before the timeline. */
const COUNTDOWN_MS = 10_000;

test("the crew's owner ends a member's session", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const owner = await riders(OWNER);
	const opened = await channels.open(
		owner,
		`Admin Ends ${Date.now() % 100000}`,
	);
	const coach = await riders(COACH);
	await channels.enter(coach, opened);
	await owner.goto(voicePath(opened));

	// A member starts one, unpaired (#2594), and is its coach.
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
	await expect(
		coach.getByRole('button', { name: 'end the session' }),
	).toBeVisible({ timeout: COUNTDOWN_MS + 15_000 });

	// The owner is not its coach: no coach controls, and an End that names
	// whose session it ends.
	const end = owner.getByRole('button', {
		name: `End ${COACH}'s session`,
	});
	await expect(
		end,
		`${OWNER} owns the crew and should be offered End on ${COACH}'s session`,
	).toBeVisible({ timeout: 15_000 });
	await expect(owner.getByRole('button', { name: 'arm a sprint' })).toHaveCount(
		0,
	);

	await end.click();
	await owner
		.getByRole('dialog')
		.getByRole('button', { name: 'End the session' })
		.click();

	// Ended for everyone: the channel is free again, for either of them.
	await expect(
		coach.getByRole('button', { name: 'end the session' }),
	).toHaveCount(0, { timeout: 15_000 });
	await expect(
		owner.getByRole('button', { name: 'Start a session' }),
	).toBeVisible({ timeout: 15_000 });
});
