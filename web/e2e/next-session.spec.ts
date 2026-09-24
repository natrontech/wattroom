import { expect, test, voicePath } from './crew';

/**
 * Any member starts the next session once one ends (#2596). The tick keeps a
 * done session's coach until the next pick, and the client read it raw — so
 * only the rider who had coached was offered Start, though the hub would have
 * taken anyone's pick (session_coach_test.go).
 */
const A = 'Next Session Coach';
const B = 'Next Session Member';

/** docs/SPEC.md's session lifecycle: a 10 s countdown before the timeline. */
const COUNTDOWN_MS = 10_000;

test('once a session ends, another member is offered Start a session', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Next Session ${Date.now() % 100000}`);
	const b = await riders(B);
	await channels.enter(b, opened);

	// A starts one from the voice channel — unpaired is fine, a coach may
	// lead without riding (#2594).
	await a.goto(voicePath(opened));
	await a
		.getByRole('button', { name: 'Start a session' })
		.click({ timeout: 15_000 });
	const picker = a.getByRole('dialog', { name: 'Start a session' });
	await picker
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await picker
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();
	await picker.getByRole('button', { name: 'Start without a trainer' }).click();

	// While it runs it is A's: B has no Start.
	const end = a.getByRole('button', { name: 'end the session' });
	await expect(end).toBeVisible({ timeout: COUNTDOWN_MS + 15_000 });
	await expect(b.getByRole('button', { name: 'Start a session' })).toHaveCount(
		0,
	);

	// A ends it. The session is done, and its coach is still on the tick.
	await end.click();
	await a
		.getByRole('dialog')
		.getByRole('button', { name: 'End the session' })
		.click();

	await expect(
		b.getByRole('button', { name: 'Start a session' }),
		`${B} should be offered the next session once ${A}'s has ended`,
	).toBeVisible({ timeout: 15_000 });
	await expect(
		a.getByRole('button', { name: 'Start a session' }),
	).toBeVisible();
});
