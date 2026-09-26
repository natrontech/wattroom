import { expect, test, voicePath } from './crew';

/**
 * The coach hands the session on (#2636). The hub and the protocol always
 * could (TestHandOff); no screen sent it, so a coach who had to leave either
 * ended the ride for everyone or walked away from it.
 */
const COACH = 'Hand Off Coach';
const TAKER = 'Hand Off Taker';

/** docs/SPEC.md's session lifecycle: a 10 s countdown before the timeline. */
const COUNTDOWN_MS = 10_000;

test('the coach hands the session to another rider', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const coach = await riders(COACH);
	const opened = await channels.open(coach, `Hand Off ${Date.now() % 100000}`);
	const taker = await riders(TAKER);
	await channels.enter(taker, opened);

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

	// A session goes to someone riding in it (ADR-0059, #2829): the taker
	// joins the ride first, which is what puts them on the coach's list.
	await taker
		.getByRole('link', { name: 'Join the ride' })
		.click({ timeout: COUNTDOWN_MS + 15_000 });

	// The visible way in, beside the coach's other controls.
	await coach
		.getByRole('button', { name: 'hand the session off' })
		.click({ timeout: COUNTDOWN_MS + 15_000 });
	await coach
		.getByRole('dialog', { name: 'Hand the session off' })
		.getByRole('button', { name: new RegExp(TAKER) })
		.click();

	// The controls moved, and the channel says so.
	await expect(
		taker.getByRole('button', { name: 'end the session' }),
		`${TAKER} should hold the coach's controls after the hand-off`,
	).toBeVisible({ timeout: 15_000 });
	await expect(
		taker.getByText("You're coaching the session now."),
	).toBeVisible();
	await expect(
		coach.getByRole('button', { name: 'end the session' }),
	).toHaveCount(0);
	// The line is the channel's, read on its page (#2599). The taker rides
	// the session now (#2829), so they walk back to the channel inside the
	// app: its timeline lives in the channel's store, and a reload drops it.
	const line = `${COACH} handed the session to ${TAKER}`;
	await taker
		.locator(`a[href="${voicePath(opened)}"]`)
		.first()
		.click();
	await expect(taker.getByText(line)).toBeVisible({ timeout: 15_000 });
});
